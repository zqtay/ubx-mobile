import type { GnssEvent } from '@/domain/events';
import { buildUbx } from '@/protocols/ubx/builder';
import { navPvt } from '@/protocols/ubx/encoders';
import { UBX } from '@/protocols/ubx/ids';
import { GnssAccumulator } from '@/state/GnssAccumulator';

import {
  BE122_SIM,
  BZ251_SIM,
  FakeUsbNative,
  GENERIC_NMEA_SIM,
  type SimReceiver,
} from '../../../test/helpers/fakeUsb';
import type { UsbSerialModule } from '../../../modules/usb-serial';
import { AUTO_BAUD_ORDER, baudCandidates, detectBaud, type DetectionLink } from '../usb/detection';
import {
  buildMonitoringFrame,
  MonitoringChannelError,
  PERIODIC_POLLS,
  UbxClient,
} from '../usb/UbxClient';
import { matchesRef, refOf, UsbSerialSource } from '../usb/UsbSerialSource';

const frame = (cls: number, id: number, payload = new Uint8Array(0)) => ({
  kind: 'ubx' as const,
  cls,
  id,
  payload,
  rxMs: 0,
  endOffset: 0,
});

describe('monitoring channel allow-list (REQ-SER-08)', () => {
  it('builds polls of read-only messages and CFG-VALGET', () => {
    for (const msg of [
      UBX.NAV_PVT,
      UBX.NAV_SAT,
      UBX.NAV_SVINFO,
      UBX.MON_VER,
      UBX.MON_HW,
      UBX.SEC_UNIQID,
    ]) {
      expect(buildMonitoringFrame(msg)).toEqual(buildUbx(msg[0], msg[1]));
    }
    expect(
      buildMonitoringFrame(UBX.CFG_VALGET, Uint8Array.of(0, 0, 0, 0, 1, 0, 0x21, 0x30)).length,
    ).toBe(16);
  });

  it.each([
    ['CFG-VALSET', UBX.CFG_VALSET, Uint8Array.of(0, 1, 0, 0)],
    ['CFG-VALSET to flash', UBX.CFG_VALSET, Uint8Array.of(0, 4, 0, 0)],
    ['CFG-VALDEL', UBX.CFG_VALDEL, Uint8Array.of(0, 6, 0, 0)],
    ['CFG-CFG', UBX.CFG_CFG, new Uint8Array(12)],
    ['CFG-RST', UBX.CFG_RST, new Uint8Array(4)],
    ['CFG-MSG', UBX.CFG_MSG, Uint8Array.of(1, 7, 1)],
    ['UPD-SOS', [0x09, 0x14] as const, undefined],
    ['a poll with a payload', UBX.NAV_PVT, Uint8Array.of(1)],
    ['CFG-VALGET without request', UBX.CFG_VALGET, undefined],
  ] as const)('refuses %s', (_name, msg, payload) => {
    expect(() => buildMonitoringFrame(msg, payload)).toThrow(MonitoringChannelError);
  });
});

describe('UbxClient (technical spec §6.6)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  function client() {
    const sent: Uint8Array[] = [];
    const c = new UbxClient(async (f) => sent.push(f), { now: () => Date.now() });
    return { c, sent };
  }

  it('resolves a poll when the response arrives', async () => {
    const { c, sent } = client();
    const p = c.poll(UBX.MON_VER);
    expect(c.poll(UBX.MON_VER)).toBe(p); // concurrent polls share one request
    c.onFrame(frame(0x0a, 0x04));
    await expect(p).resolves.toBe(true);
    expect(sent).toHaveLength(1);
    expect(c.seenRecently(UBX.MON_VER, 100)).toBe(true);
  });

  it('retries on timeout and gives up, marking repeat offenders unsupported', async () => {
    const { c, sent } = client();
    for (let round = 0; round < 3; round++) {
      const p = c.poll(UBX.NAV_SIG);
      await jest.advanceTimersByTimeAsync(4600);
      await expect(p).resolves.toBe(false);
    }
    expect(sent).toHaveLength(9); // 3 rounds × (1 + 2 retries)
    expect(c.isSupported(UBX.NAV_SIG)).toBe(false);
    await expect(c.poll(UBX.NAV_SIG)).resolves.toBe(false);
  });

  it('learns from ACK-NAK and falls back (NAV-SAT → NAV-SVINFO, MON-RF → MON-HW)', async () => {
    const { c, sent } = client();
    const p = c.poll(UBX.NAV_SAT);
    c.onFrame(frame(0x05, 0x00, Uint8Array.of(0x01, 0x35)));
    await expect(p).resolves.toBe(false);
    expect(c.effective(UBX.NAV_SAT)).toEqual(UBX.NAV_SVINFO);

    const identity = c.pollIdentity();
    const reply = async (cls: number, id: number, nak = false) => {
      await jest.advanceTimersByTimeAsync(1);
      c.onFrame(nak ? frame(0x05, 0x00, Uint8Array.of(cls, id)) : frame(cls, id));
    };
    await reply(0x0a, 0x04); // MON-VER
    await reply(0x27, 0x03); // SEC-UNIQID
    await reply(0x0a, 0x28); // MON-GNSS
    await reply(0x0a, 0x38, true); // MON-RF unsupported
    await reply(0x0a, 0x09); // → MON-HW
    await identity;
    const names = sent.map((f) => `${f[2]}:${f[3]}`);
    expect(names.slice(-5)).toEqual(['10:4', '39:3', '10:40', '10:56', '10:9']);
  });

  it('polls navigation data each second, skipping what the receiver already outputs', async () => {
    const { c, sent } = client();
    c.onFrame(frame(0x01, 0x07)); // NAV-PVT arrives unsolicited (e.g. BZ-251)
    c.startScheduler(1000);
    const polled = () => sent.map((f) => `${f[2]}:${f[3]}`);
    expect(polled()).not.toContain('1:7');
    expect(polled()).toEqual(expect.arrayContaining(['1:53', '1:67', '1:4', '1:3']));

    // Answer everything, then the next tick polls again (NAV-PVT is still unsolicited).
    for (const [cls, id] of PERIODIC_POLLS) c.onFrame(frame(cls, id));
    c.onFrame(frame(0x01, 0x07));
    sent.length = 0;
    await jest.advanceTimersByTimeAsync(1000);
    expect(polled()).toHaveLength(4);

    c.setPaused(true);
    sent.length = 0;
    await jest.advanceTimersByTimeAsync(2000);
    expect(sent).toHaveLength(0);
    c.dispose();
  });
});

describe('baud detection (technical spec §6.7)', () => {
  it('orders candidates', () => {
    expect(baudCandidates({ setting: 'auto', nativeUsb: false })).toEqual(AUTO_BAUD_ORDER);
    expect(baudCandidates({ setting: 'auto', nativeUsb: false, remembered: 57600 })[0]).toBe(57600);
    expect(
      new Set(baudCandidates({ setting: 'auto', nativeUsb: false, remembered: 57600 })).size,
    ).toBe(AUTO_BAUD_ORDER.length);
    expect(baudCandidates({ setting: 115200, nativeUsb: false, remembered: 57600 })).toEqual([
      115200,
    ]);
    expect(baudCandidates({ setting: 'auto', nativeUsb: true })).toEqual([38400]);
  });

  /** A link to a simulated receiver that outputs frames at `talkBaud` and answers polls at `pollBaud`. */
  function link(opts: {
    talkBaud?: number;
    pollBaud?: number;
  }): DetectionLink & { bauds: number[] } {
    let baud = 0;
    let valid = 0;
    let ubx = 0;
    const bauds: number[] = [];
    return {
      bauds,
      setBaud: async (b) => {
        baud = b;
        bauds.push(b);
      },
      write: async () => {
        if (baud === opts.pollBaud) {
          valid += 1;
          ubx += 1;
        }
      },
      validFrames: () => valid,
      ubxFrames: () => ubx,
      sleep: async () => {
        if (baud === opts.talkBaud) valid += 5;
      },
    };
  }

  it('finds a talkative receiver by listening', async () => {
    const l = link({ talkBaud: 115200 });
    await expect(detectBaud(l, { candidates: AUTO_BAUD_ORDER, probeUbx: true })).resolves.toEqual({
      baud: 115200,
      ubx: false,
    });
  });

  it('finds a silent u-blox receiver by probing with MON-VER (BE-122)', async () => {
    const l = link({ pollBaud: 57600 });
    await expect(detectBaud(l, { candidates: AUTO_BAUD_ORDER, probeUbx: true })).resolves.toEqual({
      baud: 57600,
      ubx: true,
    });
    expect(l.bauds).toEqual([38400, 115200, 57600]);
    // Without probing, a silent receiver cannot be found.
    await expect(
      detectBaud(link({ pollBaud: 57600 }), { candidates: AUTO_BAUD_ORDER, probeUbx: false }),
    ).resolves.toEqual({
      ubx: false,
    });
  });
});

describe('UsbSerialSource (REQ-SER)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  async function run(
    receiver: SimReceiver,
    options: Partial<ConstructorParameters<typeof UsbSerialSource>[0]> = {},
    configure?: (n: FakeUsbNative) => void,
  ) {
    const native = new FakeUsbNative(receiver);
    configure?.(native);
    const events: GnssEvent[] = [];
    const acc = new GnssAccumulator({ satelliteTimeoutMs: 60_000 });
    acc.start('usb');
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
      ...options,
    });
    const started = source.start((e) => {
      events.push(e);
      acc.apply(e);
    });
    await jest.advanceTimersByTimeAsync(3000);
    await started;
    const state = () => acc.snapshot();
    const last = <T extends GnssEvent['t']>(t: T) =>
      [...events].reverse().find((e): e is Extract<GnssEvent, { t: T }> => e.t === t);
    return { native, source, events, state, last, detected };
  }

  it('detects the silent BE-122 at 57600 by probing, identifies it and polls data', async () => {
    const { native, state, detected } = await run(BE122_SIM);
    expect(native.requestPermission).toHaveBeenCalledTimes(1);
    expect(detected).toEqual([57600]);
    const s = state();
    expect(s.connection).toEqual({ kind: 'receiving' });
    expect(s.device.usb).toMatchObject({
      vendorId: 0x10c4,
      productId: 0xea60,
      driver: 'cp210x',
      baud: 57600,
    });
    expect(s.device.receiver).toMatchObject({
      vendor: 'u-blox',
      fwVersion: 'SPG 5.10',
      uniqueId: '9A3C5107E2',
      gnssEnabled: ['GPS', 'BEIDOU', 'GALILEO'],
    });
    expect(s.device.receiver.rf?.[0].antennaStatus).toBe('ok');
    expect(s.fix).toMatchObject({ fixType: '3d', numSvUsed: 9 });
    expect(s.satellites.map((x) => x.key)).toEqual(['GPS:14', 'GALILEO:16']);
    expect(s.session?.ttffMs).toBe(26_000);
  });

  it('only ever sends read-only polls to the receiver (REQ-SER-08)', async () => {
    const { native } = await run(BE122_SIM);
    expect(native.written.length).toBeGreaterThan(10);
    for (const w of native.written) {
      expect(w.payloadLength).toBe(0);
      expect(() => buildMonitoringFrame([w.cls, w.id])).not.toThrow();
    }
  });

  it('detects the talkative BZ-251 at 115200 by listening and does not poll NAV-PVT', async () => {
    const { native, state, detected } = await run(BZ251_SIM);
    expect(detected).toEqual([115200]);
    expect(state().device.receiver).toMatchObject({ vendor: 'u-blox', nmeaDetected: true });
    const navPvtPolls = native.written.filter((w) => w.cls === 0x01 && w.id === 0x07);
    expect(navPvtPolls).toHaveLength(0);
    expect(native.written.some((w) => w.cls === 0x01 && w.id === 0x35)).toBe(true); // NAV-SAT polled
  });

  it('treats a receiver that never answers UBX as generic NMEA and does not poll it', async () => {
    const { native, state, detected } = await run(GENERIC_NMEA_SIM);
    expect(detected).toEqual([9600]);
    expect(state().device.receiver).toMatchObject({ vendor: 'generic', nmeaDetected: true });
    const after = native.written.length;
    await jest.advanceTimersByTimeAsync(5000);
    expect(native.written.length).toBe(after);
    expect(state().satellites.length).toBe(2);
  });

  it('uses the remembered baud first and a fixed baud only', async () => {
    const remembered = await run(BE122_SIM, { rememberedBaud: 57600 });
    expect(remembered.native.openCalls[0].options.baudRate).toBe(57600);
    expect(remembered.native.setParameters.mock.calls.map((c) => c[1].baudRate)).toEqual([57600]);

    const fixed = await run(BE122_SIM, { baud: 9600 });
    expect(fixed.state().connection).toMatchObject({ kind: 'error', code: 'E_NO_DATA' });
    expect(fixed.native.setParameters.mock.calls.map((c) => c[1].baudRate)).toEqual([9600]);
  });

  it('reports a denied permission, an unsupported phone and no data', async () => {
    const denied = await run(BE122_SIM, {}, (n) => (n.grantPermission = false));
    expect(denied.state().connection).toMatchObject({ kind: 'error', code: 'E_USB_PERMISSION' });
    expect(denied.native.open).not.toHaveBeenCalled();

    const noHost = await run(BE122_SIM, {}, (n) => (n.hostSupported = false));
    expect(noHost.state().connection).toMatchObject({ code: 'E_USB_UNSUPPORTED' });

    const nothing = await run({ baud: 1, ubx: false });
    expect(nothing.state().connection).toMatchObject({
      code: 'E_NO_DATA',
      message: expect.stringMatching(/wiring/),
    });

    const events: GnssEvent[] = [];
    await new UsbSerialSource({
      device: denied.native.devices[0],
      native: null,
      baud: 'auto',
      probeUbx: true,
      setDtrRts: true,
    }).start((e) => events.push(e));
    expect(events.pop()).toMatchObject({ state: { code: 'E_USB_UNSUPPORTED' } });
  });

  it('keeps data when unplugged and reconnects at the known baud when replugged (REQ-SER-11/12)', async () => {
    const { native, state } = await run(BE122_SIM);
    native.unplug();
    expect(state().connection).toMatchObject({ kind: 'disconnected' });
    expect(state().stale).toBe(true);
    expect(state().satellites.length).toBe(2);

    native.replug();
    await jest.advanceTimersByTimeAsync(2000);
    expect(native.requestPermission).toHaveBeenCalledTimes(2);
    expect(native.openCalls.at(-1)?.options.baudRate).toBe(57600);
    expect(native.setParameters.mock.calls.at(-1)?.[1].baudRate).toBe(57600);
    expect(state().connection).toEqual({ kind: 'receiving' });
  });

  it('closes the port in the background and reopens it in the foreground (REQ-NFR-08)', async () => {
    const { native, source, state } = await run(BE122_SIM);
    await source.suspend();
    expect(native.openSessions).toBe(0);
    const resumed = source.resume();
    await jest.advanceTimersByTimeAsync(2000);
    await resumed;
    expect(native.openSessions).toBe(1);
    expect(state().connection).toEqual({ kind: 'receiving' });

    await source.stop();
    expect(native.openSessions).toBe(0);
    expect(state().connection).toEqual({ kind: 'idle' });

    // Resuming after the device is gone reports it as disconnected.
    const other = await run(BE122_SIM);
    await other.source.suspend();
    other.native.devices = [];
    await other.source.resume();
    expect(other.state().connection).toMatchObject({ kind: 'disconnected' });
  });

  it('identifies devices across replugs by VID, PID and serial', () => {
    const device = {
      vendorId: 1,
      productId: 2,
      serialNumber: 'A',
      deviceId: 5,
      deviceName: '',
      driver: 'ftdi' as const,
      portCount: 1,
      hasPermission: true,
    };
    expect(refOf(device)).toEqual({ vendorId: 1, productId: 2, serialNumber: 'A' });
    expect(refOf({ ...device, serialNumber: null })).toEqual({ vendorId: 1, productId: 2 });
    expect(matchesRef({ ...device, deviceId: 9 }, refOf(device))).toBe(true);
    expect(matchesRef({ ...device, serialNumber: 'B' }, refOf(device))).toBe(false);
    expect(matchesRef({ ...device, serialNumber: 'B' }, { vendorId: 1, productId: 2 })).toBe(true);
  });

  it('feeds unsolicited UBX output into the pipeline', async () => {
    const { native, state } = await run(BZ251_SIM);
    expect(state().stats.ubxFrames).toBeGreaterThan(5);
    expect(navPvt().length).toBe(100);
    expect(native.openSessions).toBe(1);
  });
});
