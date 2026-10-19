import { configAvailability } from '@/config/availability';
import { backupItems, createBackup, listBackups } from '@/config/backups';
import { ConfigService } from '@/config/ConfigService';
import { KEY, msgoutKey, OUTPUT_MESSAGES } from '@/config/keys';
import { checkRules, estimatedOutputBytesPerSecond, navRateHz } from '@/config/rules';
import {
  allSectionKeys,
  availableSettings,
  formatSettingValue,
  sectionById,
  SECTIONS,
} from '@/config/sections';
import {
  buildFactoryResetFrame,
  buildResetFrame,
  buildValDelFrame,
  buildValGetPayload,
  buildValSetFrames,
  decodeValue,
  encodeValue,
  parseValGetResponse,
} from '@/config/valCodec';
import type { GnssEvent } from '@/domain/events';
import { UBX } from '@/protocols/ubx/ids';
import { ConfigWriteRequest, MonitoringChannelError, UbxClient } from '@/sources/usb/UbxClient';
import { UsbSerialSource } from '@/sources/usb/UsbSerialSource';
import { createConfigStore, effectiveValues, findings, unsavedKeys } from '@/state/configStore';
import { useDiagnostics } from '@/state/diagnostics';
import { storage } from '@/state/storage';

import { BE122_DUMP, BZ251_DUMP } from '../../../test/fixtures/m10Dumps';
import { dumpRamValues, type SimConfigOptions } from '../../../test/helpers/configSim';
import { BE122_SIM, FakeUsbNative } from '../../../test/helpers/fakeUsb';
import type { UsbSerialModule } from '../../../modules/usb-serial';

const BE122 = dumpRamValues(BE122_DUMP);

describe('value codec (CFG-VALGET/VALSET)', () => {
  it('encodes and decodes values by key size and sign', () => {
    const view = new DataView(new ArrayBuffer(8));
    encodeValue(KEY.NAVSPG_INFIL_MINELEV, -5, view, 0); // I1
    expect(decodeValue(KEY.NAVSPG_INFIL_MINELEV, view, 0)).toBe(-5);
    encodeValue(KEY.UART1_BAUDRATE, 921600, view, 0); // U4
    expect(decodeValue(KEY.UART1_BAUDRATE, view, 0)).toBe(921600);
    encodeValue(KEY.RATE_MEAS, 1000, view, 4); // U2
    expect(decodeValue(KEY.RATE_MEAS, view, 4)).toBe(1000);
  });

  it('builds VALGET polls of at most 64 keys', () => {
    expect(buildValGetPayload(2, [KEY.RATE_MEAS])).toEqual(
      Uint8Array.of(0, 2, 0, 0, 0x01, 0x00, 0x21, 0x30),
    );
    expect(() => buildValGetPayload(0, new Array(65).fill(KEY.RATE_MEAS))).toThrow();
  });

  it('uses one VALSET message up to 64 items and a transaction beyond', () => {
    const items = (n: number) =>
      Array.from({ length: n }, () => ({ key: KEY.NMEA_HIGHPREC, value: 1 }));
    const [single] = buildValSetFrames(1, items(3));
    expect([...single.subarray(6, 9)]).toEqual([0, 1, 0]);
    const frames = buildValSetFrames(1, items(130));
    expect(frames.map((f) => [f[6], f[8]])).toEqual([
      [1, 1],
      [1, 2],
      [1, 3],
    ]);
    // A VALSET payload parses like a VALGET response.
    expect(parseValGetResponse(single.subarray(6, single.length - 2))?.items).toHaveLength(3);
  });

  it('builds GNSS-only restarts and the factory reset', () => {
    expect([...buildResetFrame('cold').subarray(6, 10)]).toEqual([0xff, 0xff, 0x02, 0x00]);
    expect([...buildResetFrame('hot', 'software').subarray(6, 10)]).toEqual([0, 0, 0x01, 0]);
    const cfg = buildFactoryResetFrame();
    expect(cfg.length).toBe(8 + 13);
    expect(cfg[cfg.length - 3]).toBe(0x17);
  });

  it('builds VALDEL and restores items from a backup', () => {
    const del = buildValDelFrame(6, [KEY.RATE_MEAS]);
    expect([...del.subarray(6, 14)]).toEqual([0, 6, 0, 0, 0x01, 0x00, 0x21, 0x30]);
    const backup = createBackup('manual', {}, [{ key: KEY.RATE_MEAS, value: 200 }], 0);
    expect(backup.layers.ram).toEqual([{ id: '0x30210001', name: 'CFG-RATE-MEAS', value: 200 }]);
    expect(backupItems(backup)).toEqual([{ key: KEY.RATE_MEAS, value: 200 }]);
  });

  it('reads the real modules’ RAM configuration from their dumps', () => {
    expect(BE122.get(KEY.UART1_BAUDRATE)).toBe(57600);
    // The BE-122 measures at 10 Hz and has NMEA output switched off (it is silent until polled).
    expect(BE122.get(KEY.RATE_MEAS)).toBe(100);
    expect(BE122.get(KEY.UART1OUTPROT_NMEA)).toBe(0);
    const bz = dumpRamValues(BZ251_DUMP);
    expect(bz.get(KEY.UART1_BAUDRATE)).toBe(115200);
    // Every key the screens know is either reported by the module or hidden.
    const reported = allSectionKeys('UART1').filter((k) => BE122.has(k));
    expect(reported.length).toBeGreaterThan(40);
  });
});

describe('configuration rules', () => {
  const values = (patch: [number, number][] = []) => new Map([...BE122, ...patch]);

  it('accepts the BE-122 configuration', () => {
    expect(checkRules(values(), 'UART1', 57600)).toEqual([]);
  });

  it('refuses changes that would lock the app out (REQ-CFG-10)', () => {
    const ids = checkRules(
      values([
        [KEY.UART1INPROT_UBX, 0],
        [KEY.UART1OUTPROT_UBX, 0],
        [KEY.UART1OUTPROT_NMEA, 0],
      ]),
      'UART1',
      57600,
    ).map((f) => [f.id, f.severity]);
    expect(ids).toEqual([
      ['lockoutUbxIn', 'error'],
      ['lockoutUbxOut', 'error'],
      ['lockoutNoOutput', 'error'],
    ]);
  });

  it('requires a constellation and a valid rate', () => {
    const off = [
      KEY.SIGNAL_GPS_ENA,
      KEY.SIGNAL_GAL_ENA,
      KEY.SIGNAL_BDS_ENA,
      KEY.SIGNAL_QZSS_ENA,
      KEY.SIGNAL_GLO_ENA,
    ];
    expect(checkRules(values(off.map((k) => [k, 0])), 'UART1', 57600).map((f) => f.id)).toEqual([
      'noConstellation',
    ]);
    expect(checkRules(values([[KEY.RATE_MEAS, 10]]), 'UART1', 57600).map((f) => f.id)).toEqual([
      'rateInvalid',
    ]);
    expect(checkRules(values([[KEY.RATE_MEAS, 50]]), 'UART1', 57600)).toContainEqual({
      id: 'rateHigh',
      severity: 'warning',
      params: { hz: 20 },
    });
    expect(
      navRateHz(
        values([
          [KEY.RATE_MEAS, 200],
          [KEY.RATE_NAV, 2],
        ]),
      ),
    ).toBe(2.5);
  });

  it('warns when the output will not fit the baud rate', () => {
    const gsv = OUTPUT_MESSAGES.find((m) => m.label === 'GSV')!;
    const v = values([
      [msgoutKey(gsv, 'UART1'), 1],
      [KEY.UART1OUTPROT_NMEA, 1],
      [KEY.RATE_MEAS, 200],
    ]);
    expect(estimatedOutputBytesPerSecond(v, 'UART1')).toBe(3500); // GSV 700 B × 5 Hz
    expect(checkRules(v, 'UART1', 9600).map((f) => f.id)).toContain('throughput');
    expect(checkRules(v, 'USB', undefined).map((f) => f.id)).not.toContain('throughput');
    // Messages of a disabled protocol do not count.
    expect(
      estimatedOutputBytesPerSecond(new Map([...v, [KEY.UART1OUTPROT_NMEA, 0]]), 'UART1'),
    ).toBeLessThan(estimatedOutputBytesPerSecond(v, 'UART1'));
  });
});

describe('configuration sections', () => {
  it('shows only settings the receiver reports, per port', () => {
    const port = sectionById('port')!;
    expect(availableSettings(port, 'UART1', BE122).map((s) => s.key)).toEqual([
      KEY.UART1_BAUDRATE,
      KEY.UART1INPROT_UBX,
      KEY.UART1INPROT_NMEA,
      KEY.UART1OUTPROT_UBX,
      KEY.UART1OUTPROT_NMEA,
    ]);
    expect(port.settings('USB').some((s) => s.key === KEY.UART1_BAUDRATE)).toBe(false);
    expect(availableSettings(port, 'UART1', new Map())).toEqual([]);
    expect(sectionById('nope')).toBeUndefined();
    expect(SECTIONS.map((s) => s.id)).toEqual([
      'rate',
      'port',
      'gnss',
      'messages',
      'navigation',
      'nmea',
    ]);
  });

  it('formats values', () => {
    const [meas, nav] = sectionById('rate')!.settings('UART1');
    const onOff: [string, string] = ['On', 'Off'];
    expect(formatSettingValue(meas, 1000, onOff)).toBe('1 Hz');
    expect(formatSettingValue(meas, 125, onOff)).toBe('125');
    expect(formatSettingValue(nav, 3, onOff)).toBe('3');
    expect(formatSettingValue(sectionById('port')!.settings('UART1')[1], 1, onOff)).toBe('On');
    expect(formatSettingValue(nav, undefined, onOff)).toBe('—');
  });
});

describe('configuration availability (REQ-CFG-01)', () => {
  const snap = (patch: object = {}, receiver: object = {}) => ({
    source: 'usb' as const,
    connection: { kind: 'receiving' as const },
    device: { receiver: { vendor: 'u-blox' as const, protocolVersion: '34.10', ...receiver } },
    ...patch,
  });

  it('needs a connected u-blox receiver with protocol 27 or later over USB', () => {
    expect(configAvailability(snap())).toBe('ok');
    expect(configAvailability(snap({ source: 'android' }))).toBe('notUsb');
    expect(configAvailability(snap({ connection: { kind: 'detecting' } }))).toBe('notConnected');
    expect(configAvailability(snap({}, { vendor: 'generic' }))).toBe('notUblox');
    expect(configAvailability(snap({}, { protocolVersion: '18.00' }))).toBe('protocolTooOld');
    expect(configAvailability(snap({}, { protocolVersion: undefined }))).toBe('protocolTooOld');
  });
});

describe('UbxClient configuration channel', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  const ackFrame = (ok: boolean, cls: number, id: number) => ({
    kind: 'ubx' as const,
    cls: 0x05,
    id: ok ? 0x01 : 0x00,
    payload: Uint8Array.of(cls, id),
    rxMs: 0,
    endOffset: 0,
  });

  it('only accepts configuration writes', () => {
    expect(() => new ConfigWriteRequest('apply', [buildValGetPayload(0, [])], 'x')).toThrow(
      MonitoringChannelError,
    );
    expect(() => new ConfigWriteRequest('apply', [buildResetFrame('hot')], 'x')).not.toThrow();
  });

  it('waits for each ACK, stops at a NAK and pauses polling meanwhile', async () => {
    const sent: Uint8Array[] = [];
    const c = new UbxClient(async (f) => void sent.push(f), { now: () => Date.now() });
    const frames = buildValSetFrames(
      1,
      Array.from({ length: 130 }, () => ({ key: KEY.NMEA_HIGHPREC, value: 1 })),
    );
    const p = c.configure(new ConfigWriteRequest('apply', frames, 'x'));
    await jest.advanceTimersByTimeAsync(1);
    expect(sent).toHaveLength(1);
    c.onFrame(ackFrame(true, 0x06, 0x8a));
    await jest.advanceTimersByTimeAsync(1);
    c.onFrame(ackFrame(false, 0x06, 0x8a));
    await expect(p).resolves.toEqual({ ok: false, outcomes: ['ack', 'nak'] });
    expect(sent).toHaveLength(2);
    // A configuration NAK does not mark anything unsupported.
    expect(c.isSupported(UBX.CFG_VALSET)).toBe(true);

    const rst = c.configure(new ConfigWriteRequest('restart', [buildResetFrame('cold')], 'x'), 100);
    await expect(rst).resolves.toEqual({ ok: true, outcomes: ['sent'] });

    const timeout = c.configure(new ConfigWriteRequest('apply', [frames[0]], 'x'), 100);
    await jest.advanceTimersByTimeAsync(150);
    await expect(timeout).resolves.toEqual({ ok: false, outcomes: ['timeout'] });
  });

  it('reads with VALGET: response, NAK or timeout', async () => {
    const c = new UbxClient(async () => undefined, { now: () => Date.now() });
    const ok = c.valget(buildValGetPayload(0, [KEY.RATE_MEAS]));
    await jest.advanceTimersByTimeAsync(1);
    const response = Uint8Array.of(1, 0, 0, 0, 0x01, 0x00, 0x21, 0x30, 0xe8, 0x03);
    c.onFrame({ kind: 'ubx', cls: 0x06, id: 0x8b, payload: response, rxMs: 0, endOffset: 0 });
    await expect(ok).resolves.toEqual(response);

    const nak = c.valget(buildValGetPayload(0, [0x10ff0001]));
    await jest.advanceTimersByTimeAsync(1);
    c.onFrame(ackFrame(false, 0x06, 0x8b));
    await expect(nak).resolves.toBe('nak');

    const timeout = c.valget(buildValGetPayload(0, [KEY.RATE_MEAS]), 100);
    await jest.advanceTimersByTimeAsync(150);
    await expect(timeout).resolves.toBe('timeout');
  });
});

/** A USB session with the simulated BE-122 and its configuration database. */
async function session(config: SimConfigOptions | null = {}) {
  const native = new FakeUsbNative({ ...BE122_SIM, config: config ?? undefined });
  const events: GnssEvent[] = [];
  const detected: number[] = [];
  const source = new UsbSerialSource({
    device: native.devices[0],
    native: native as unknown as UsbSerialModule,
    baud: 'auto',
    probeUbx: true,
    setDtrRts: true,
    listenMs: 50,
    probeMs: 50,
    onBaudDetected: (_ref, baud) => detected.push(baud),
  });
  const started = source.start((e) => void events.push(e));
  await jest.advanceTimersByTimeAsync(3000);
  await started;
  const link = source.configLink();
  if (!link) throw new Error('no config link');
  const service = new ConfigService(link, { module: 'BE-122' });
  return { native, sim: native.config!, source, service, events, detected };
}

/** Advances fake timers until `promise` settles. */
async function settle<T>(promise: Promise<T>, maxMs = 30_000): Promise<T> {
  let done = false;
  promise.then(
    () => (done = true),
    () => (done = true),
  );
  for (let t = 0; !done && t < maxMs; t += 50) await jest.advanceTimersByTimeAsync(50);
  return promise;
}

describe('ConfigService on the simulated BE-122 (REQ-CFG)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    storage.clearAll();
    useDiagnostics.getState().clear();
  });
  afterEach(() => jest.useRealTimers());

  it('loads current, stored and default values, skipping keys the receiver does not know', async () => {
    const { service } = await session();
    const keys = [...allSectionKeys('UART1'), 0x10ff0001];
    const loaded = await settle(service.load(keys));
    expect(loaded.ram.get(KEY.UART1_BAUDRATE)).toBe(57600);
    expect(loaded.ram.has(0x10ff0001)).toBe(false);
    expect(loaded.ram.size).toBe(keys.filter((k) => BE122.has(k)).length);
    expect(loaded.def).toEqual(loaded.ram);
    expect(loaded.bbr.size).toBe(0);
    expect(loaded.hasFlash).toBe(false);
  });

  it('applies to RAM, verifies, backs up once and logs (REQ-CFG-03/04)', async () => {
    const { service, sim } = await session();
    const result = await settle(service.apply([{ key: KEY.NAVSPG_DYNMODEL, value: 4 }]));
    expect(result).toEqual({ status: 'applied', mismatches: [] });
    expect(sim.ram.get(KEY.NAVSPG_DYNMODEL)).toBe(4);
    expect(sim.bbr.size).toBe(0);
    await settle(service.apply([{ key: KEY.RATE_MEAS, value: 500 }]));
    const backups = listBackups();
    expect(backups).toHaveLength(1);
    expect(backups[0]).toMatchObject({ kind: 'auto', receiver: { module: 'BE-122' } });
    expect(backups[0].layers.ram[0]).toMatchObject({
      name: 'CFG-NAVSPG-DYNMODEL',
      value: BE122.get(KEY.NAVSPG_DYNMODEL),
    });
    const log = useDiagnostics.getState().entries;
    expect(log.map((e) => e.message)).toEqual(['apply: ok', 'apply: ok']);
    expect(log[0].details).toContain('CFG-NAVSPG-DYNMODEL=4');
  });

  it('reports a NAK as rejected and a value that did not stick as a mismatch', async () => {
    const rejecting = await session({ rejectKeys: [KEY.RATE_MEAS] });
    await expect(
      settle(rejecting.service.apply([{ key: KEY.RATE_MEAS, value: 50 }])),
    ).resolves.toEqual({
      status: 'rejected',
      mismatches: [],
    });
    expect(rejecting.sim.ram.get(KEY.RATE_MEAS)).toBe(100);

    const sticky = await session({ stickyKeys: [KEY.NAVSPG_FIXMODE] });
    const result = await settle(sticky.service.apply([{ key: KEY.NAVSPG_FIXMODE, value: 2 }]));
    expect(result.status).toBe('mismatch');
    expect(result.mismatches).toEqual([
      { key: KEY.NAVSPG_FIXMODE, expected: 2, actual: BE122.get(KEY.NAVSPG_FIXMODE) },
    ]);
  });

  it('changes the baud rate safely: follows the receiver to the new rate (REQ-CFG-09)', async () => {
    const { service, native, detected, source } = await session();
    const result = await settle(service.apply([{ key: KEY.UART1_BAUDRATE, value: 115200 }]));
    expect(result.status).toBe('applied');
    expect(native.receiver.baud).toBe(115200);
    expect(native.setParameters).toHaveBeenLastCalledWith(expect.any(String), { baudRate: 115200 });
    expect(detected).toEqual([57600, 115200]);
    expect(source.configLink()?.localBaud).toBe(115200);
  });

  it('returns to the old rate when the receiver does not switch, and reports a lost receiver', async () => {
    const ignoring = await session({ baudChange: 'ignore' });
    const r1 = await settle(ignoring.service.apply([{ key: KEY.UART1_BAUDRATE, value: 115200 }]));
    expect(r1.status).toBe('baud-failed');
    expect(ignoring.native.setParameters).toHaveBeenLastCalledWith(expect.any(String), {
      baudRate: 57600,
    });
    expect(ignoring.detected).toEqual([57600]);

    const vanishing = await session({ baudChange: 'vanish' });
    const r2 = await settle(vanishing.service.apply([{ key: KEY.UART1_BAUDRATE, value: 115200 }]));
    expect(r2.status).toBe('lost');
    expect(useDiagnostics.getState().entries.at(-1)).toMatchObject({ level: 'error' });
  });

  it('saves to BBR, reverts unsaved changes and restarts (REQ-CFG-05/06b/14)', async () => {
    const { service, sim, events } = await session();
    await settle(service.apply([{ key: KEY.NAVSPG_DYNMODEL, value: 4 }]));
    await expect(settle(service.save([KEY.NAVSPG_DYNMODEL], false))).resolves.toEqual({
      status: 'applied',
      mismatches: [],
    });
    expect(sim.bbr.get(KEY.NAVSPG_DYNMODEL)).toBe(4);

    await settle(service.apply([{ key: KEY.NAVSPG_DYNMODEL, value: 6 }]));
    await settle(service.revert([{ key: KEY.NAVSPG_DYNMODEL, value: 4 }]));
    expect(sim.ram.get(KEY.NAVSPG_DYNMODEL)).toBe(4);

    await settle(service.restart('cold'));
    expect(sim.resets).toEqual([{ navBbrMask: 0xffff, mode: 0x02 }]);
    expect(events.at(-1)).toEqual({ t: 'session-restart' });
  });

  it('factory reset clears stored configuration, resets and detects the receiver again (REQ-CFG-06c)', async () => {
    const { service, sim, native } = await session();
    await settle(service.apply([{ key: KEY.NAVSPG_DYNMODEL, value: 4 }]));
    await settle(service.save([KEY.NAVSPG_DYNMODEL], false));
    const opens = native.open.mock.calls.length;
    await expect(settle(service.factoryReset([KEY.NAVSPG_DYNMODEL]))).resolves.toBe(true);
    expect(sim.bbr.size).toBe(0);
    expect(sim.ram.get(KEY.NAVSPG_DYNMODEL)).toBe(BE122.get(KEY.NAVSPG_DYNMODEL));
    expect(sim.resets.at(-1)).toEqual({ navBbrMask: 0xffff, mode: 0x01 });
    expect(native.open.mock.calls.length).toBeGreaterThan(opens);
  });
});

describe('configuration store', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    storage.clearAll();
  });
  afterEach(() => jest.useRealTimers());

  it('reports a receiver that does not answer configuration reads', async () => {
    const { service } = await session(null);
    const store = createConfigStore(() => service);
    await settle(store.getState().load());
    expect(store.getState()).toMatchObject({ status: 'error', error: 'timeout' });
  });

  it('is unavailable without a service', async () => {
    const store = createConfigStore(() => undefined);
    await store.getState().load();
    expect(store.getState()).toMatchObject({ status: 'error', error: 'unavailable' });
  });

  it('stages, applies, saves and reverts', async () => {
    const { service, sim } = await session();
    const store = createConfigStore(() => service);
    const s = () => store.getState();
    await settle(s().load());
    expect(s()).toMatchObject({ status: 'ready', port: 'UART1', baud: 57600 });

    s().stage(KEY.NAVSPG_DYNMODEL, BE122.get(KEY.NAVSPG_DYNMODEL)!);
    expect(s().staged.size).toBe(0); // same as current
    s().stage(KEY.NAVSPG_DYNMODEL, 4);
    s().stage(KEY.RATE_MEAS, 500);
    s().unstage(KEY.RATE_MEAS);
    expect(effectiveValues(s()).get(KEY.NAVSPG_DYNMODEL)).toBe(4);

    await settle(s().apply());
    expect(s().staged.size).toBe(0);
    expect(s().ram.get(KEY.NAVSPG_DYNMODEL)).toBe(4);
    expect(s().lastOutcome).toMatchObject({ action: 'apply', status: 'applied' });
    expect(unsavedKeys(s())).toEqual([KEY.NAVSPG_DYNMODEL]);

    await settle(s().revertToSaved());
    expect(sim.ram.get(KEY.NAVSPG_DYNMODEL)).toBe(BE122.get(KEY.NAVSPG_DYNMODEL));
    expect(unsavedKeys(s())).toEqual([]);

    s().stage(KEY.NAVSPG_DYNMODEL, 4);
    await settle(s().apply());
    await settle(s().save());
    expect(sim.bbr.get(KEY.NAVSPG_DYNMODEL)).toBe(4);
    expect(unsavedKeys(s())).toEqual([]);
    await expect(s().save()).resolves.toBeUndefined(); // nothing to save

    await settle(s().restart('hot'));
    expect(s().lastOutcome).toMatchObject({ action: 'restart', status: 'done' });
    await settle(s().factoryReset());
    expect(s().ram.get(KEY.NAVSPG_DYNMODEL)).toBe(BE122.get(KEY.NAVSPG_DYNMODEL));

    s().reset();
    expect(s()).toMatchObject({ status: 'idle', port: undefined });
  });

  it('blocks Apply while a rule error stands and keeps changes the receiver rejects', async () => {
    const { service } = await session({ rejectKeys: [KEY.NAVSPG_DYNMODEL] });
    const store = createConfigStore(() => service);
    const s = () => store.getState();
    await settle(s().load());
    s().stage(KEY.UART1INPROT_UBX, 0);
    expect(findings(s()).map((f) => f.id)).toEqual(['lockoutUbxIn']);
    await expect(s().apply()).resolves.toBeUndefined();
    s().discard();
    s().stage(KEY.NAVSPG_DYNMODEL, 4);
    await settle(s().apply());
    expect(s().lastOutcome).toMatchObject({ status: 'rejected' });
    expect(s().staged.get(KEY.NAVSPG_DYNMODEL)).toBe(4);
  });
});
