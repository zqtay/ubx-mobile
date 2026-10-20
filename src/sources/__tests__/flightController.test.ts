import { KEY } from '@/config/keys';
import { checkRules } from '@/config/rules';
import type { GnssEvent } from '@/domain/events';
import { useDiagnostics } from '@/state/diagnostics';
import { GnssAccumulator } from '@/state/GnssAccumulator';

import {
  BE122_SIM,
  BETAFLIGHT_45,
  BZ251_SIM,
  FakeUsbNative,
  FC_DEVICE,
  type SimFlightController,
  type SimReceiver,
} from '../../../test/helpers/fakeUsb';
import type { UsbSerialModule } from '../../../modules/usb-serial';
import {
  isFlightControllerUsb,
  mspRequest,
  parseMspReplies,
  printable,
  type FlightControllerInfo,
} from '../usb/flightController';
import { UsbSerialSource } from '../usb/UsbSerialSource';

describe('MSP v1 (technical spec §16)', () => {
  it('builds requests and parses replies, rejecting bad checksums', () => {
    expect([...mspRequest(2)]).toEqual([0x24, 0x4d, 0x3c, 0, 2, 2]);
    const reply = Uint8Array.of(
      0x24,
      0x4d,
      0x3e,
      4,
      2,
      0x42,
      0x54,
      0x46,
      0x4c,
      4 ^ 2 ^ 0x42 ^ 0x54 ^ 0x46 ^ 0x4c,
    );
    const bad = Uint8Array.of(0x24, 0x4d, 0x3e, 1, 3, 9, 0);
    const error = Uint8Array.of(0x24, 0x4d, 0x21, 0, 5, 5);
    const parsed = parseMspReplies(Uint8Array.of(0x00, ...reply, ...bad, ...error));
    expect(parsed.map((r) => [r.command, String.fromCharCode(...r.payload), r.error])).toEqual([
      [2, 'BTFL', false],
      [5, '', true],
    ]);
  });

  it('recognises flight controller virtual COM ports only', () => {
    expect(isFlightControllerUsb({ vendorId: 0x0483, productId: 0x5740 })).toBe(true);
    expect(isFlightControllerUsb({ vendorId: 0x2e3c, productId: 0x5740 })).toBe(true);
    expect(isFlightControllerUsb({ vendorId: 0x0483, productId: 0x374b })).toBe(false); // ST-Link
  });
});

describe('flight controller GPS passthrough (REQ-SER-15..18)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  async function connect(
    receiver: SimReceiver,
    fc: SimFlightController | undefined,
    allow: boolean | 'no-callback' = true,
    fcListenMs = 50,
  ) {
    const native = new FakeUsbNative({ ...receiver, flightController: fc }, FC_DEVICE);
    const asked: FlightControllerInfo[] = [];
    const events: GnssEvent[] = [];
    const acc = new GnssAccumulator({ satelliteTimeoutMs: 60_000 });
    acc.start('usb');
    const source = new UsbSerialSource({
      device: native.devices[0],
      native: native as unknown as UsbSerialModule,
      baud: 'auto',
      probeUbx: true,
      setDtrRts: true,
      listenMs: 50,
      probeMs: 50,
      fcListenMs,
      confirmPassthrough:
        allow === 'no-callback'
          ? undefined
          : async (info) => {
              asked.push(info);
              return allow;
            },
    });
    const started = source.start((e) => {
      events.push(e);
      acc.apply(e);
    });
    await jest.advanceTimersByTimeAsync(8000);
    await started;
    return { native, source, asked, snapshot: acc.snapshot(), events };
  }

  it('asks, enables passthrough and then detects the GPS behind Betaflight 4.5', async () => {
    const { native, source, asked, snapshot } = await connect(BE122_SIM, BETAFLIGHT_45);
    expect(asked).toEqual([
      { variant: 'BTFL', name: 'Betaflight', version: '4.5.1', apiVersion: '1.46' },
    ]);
    // Only read-only MSP, then exactly two CLI commands: never save/exit (REQ-SER-16).
    expect(native.mspCommands).toEqual([1, 2, 3]);
    expect(native.cliCommands).toEqual(['version', 'gpspassthrough']);
    expect(snapshot.device.usb?.flightController).toEqual({
      name: 'Betaflight',
      version: '4.5.1',
      versionLine: BETAFLIGHT_45.versionLine,
      passthrough: true,
    });
    expect(snapshot.connection).toEqual({ kind: 'receiving' });
    expect(snapshot.device.receiver).toMatchObject({ vendor: 'u-blox', fwVersion: 'SPG 5.10' });
    // Configuration addresses the GPS's UART, never the flight controller's USB port.
    expect(source.configLink()).toMatchObject({ port: 'UART1', viaFlightController: true });
  });

  it('shows calendar-versioned Betaflight (2025.12) from the CLI version line', async () => {
    const fc: SimFlightController = {
      ...BETAFLIGHT_45,
      version: [25, 12, 0],
      versionLine:
        'Betaflight / STM32H743 (SH74) 2025.12.0 Dec 1 2025 / 09:00:00 (a1b2c3d) MSP API: 1.47',
    };
    const { snapshot } = await connect(BE122_SIM, fc);
    expect(snapshot.device.usb?.flightController?.versionLine).toMatch(/2025\.12\.0/);
  });

  it('sends nothing but MSP reads when the user declines', async () => {
    const { native, snapshot } = await connect(BE122_SIM, BETAFLIGHT_45, false);
    expect(native.cliCommands).toEqual([]);
    expect(native.written).toEqual([]); // no UBX either: the GPS is not reachable
    expect(snapshot.connection).toMatchObject({ kind: 'error', code: 'E_FC_DECLINED' });
    expect(snapshot.device.usb?.flightController).toBeUndefined();
  });

  it('never enables passthrough without a confirmation callback', async () => {
    const { native, snapshot } = await connect(BE122_SIM, BETAFLIGHT_45, 'no-callback');
    expect(native.cliCommands).toEqual([]);
    expect(snapshot.connection).toMatchObject({ kind: 'error', code: 'E_FC_DECLINED' });
  });

  it('reports the firmware error when the flight controller has no GPS port', async () => {
    const { native, snapshot } = await connect(BE122_SIM, { ...BETAFLIGHT_45, gps: 'no-port' });
    expect(native.cliCommands).toEqual(['version', 'gpspassthrough']);
    expect(snapshot.connection).toMatchObject({
      kind: 'error',
      code: 'E_FC_PASSTHROUGH',
      message: 'Betaflight: ERROR IN gpspassthrough: GPS forwarding failed',
    });
  });

  it('reports firmware without the command', async () => {
    const { snapshot } = await connect(BE122_SIM, { ...BETAFLIGHT_45, gps: 'unknown' });
    expect(snapshot.connection).toMatchObject({
      code: 'E_FC_PASSTHROUGH',
      message: expect.stringMatching(/Unknown command/),
    });
  });

  it('uses a flight controller already in passthrough without asking (REQ-SER-17)', async () => {
    const { native, asked, snapshot } = await connect(BZ251_SIM, {
      ...BETAFLIGHT_45,
      passthrough: true,
    });
    expect(asked).toEqual([]);
    expect(native.mspCommands).toEqual([]);
    expect(snapshot.device.usb?.flightController).toEqual({ passthrough: true });
    expect(snapshot.connection).toEqual({ kind: 'receiving' });
  });

  it('treats a flight controller that does not answer MSP as already in passthrough', async () => {
    // A silent GPS (BE-122) behind it: nothing while listening, MSP goes to the GPS unanswered.
    const { asked, native, snapshot } = await connect(BE122_SIM, {
      ...BETAFLIGHT_45,
      passthrough: true,
    });
    expect(asked).toEqual([]);
    expect(native.cliCommands).toEqual([]);
    expect(snapshot.device.usb?.flightController).toEqual({ passthrough: true });
    expect(snapshot.device.receiver.vendor).toBe('u-blox');
  });
});

describe('handshake robustness (field report: "did not open its CLI")', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    useDiagnostics.getState().clear();
  });
  afterEach(() => jest.useRealTimers());

  function source(native: FakeUsbNative, confirm: () => Promise<boolean> = async () => true) {
    return new UsbSerialSource({
      device: native.devices[0],
      native: native as unknown as UsbSerialModule,
      baud: 'auto',
      probeUbx: true,
      setDtrRts: true,
      listenMs: 50,
      probeMs: 50,
      fcListenMs: 50,
      confirmPassthrough: confirm,
    });
  }

  it('retries "#" and logs the exchange', async () => {
    const native = new FakeUsbNative(
      { ...BE122_SIM, flightController: { ...BETAFLIGHT_45, ignoreHash: 1 } },
      FC_DEVICE,
    );
    const events: GnssEvent[] = [];
    const started = source(native).start((e) => void events.push(e));
    await jest.advanceTimersByTimeAsync(8000);
    await started;
    expect(native.cliCommands).toEqual(['version', 'gpspassthrough']);
    const log = useDiagnostics.getState().entries.find((e) => e.area === 'fc');
    expect(log).toMatchObject({
      level: 'info',
      message: 'Betaflight 4.5.1: GPS passthrough enabled',
    });
    expect(log?.details?.split('\n').slice(0, 4)).toEqual([
      '> #',
      '< (nothing)',
      '> #',
      "< ⏎Entering CLI Mode, type 'exit' to return, or 'help'⏎⏎# ",
    ]);
  });

  it('explains a board that never opens its CLI, with the transcript in the log', async () => {
    const native = new FakeUsbNative(
      { ...BE122_SIM, flightController: { ...BETAFLIGHT_45, ignoreHash: Infinity } },
      FC_DEVICE,
    );
    const events: GnssEvent[] = [];
    const started = source(native).start((e) => void events.push(e));
    await jest.advanceTimersByTimeAsync(8000);
    await started;
    expect(native.cliCommands).toEqual([]);
    expect(events.at(-1)).toMatchObject({
      t: 'connection',
      state: {
        code: 'E_FC_PASSTHROUGH',
        message: 'Betaflight: The flight controller did not open its CLI (no answer to "#").',
      },
    });
    const log = useDiagnostics.getState().entries.find((e) => e.area === 'fc');
    expect(log?.details?.split('\n').filter((l) => l === '> #')).toHaveLength(3);
  });

  it('does not start a second connection when the permission dialog backgrounds the app', async () => {
    const native = new FakeUsbNative({ ...BE122_SIM, flightController: BETAFLIGHT_45 }, FC_DEVICE);
    let grant: (ok: boolean) => void = () => undefined;
    native.requestPermission.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          grant = (ok) => {
            native.devices[0].hasPermission = ok;
            resolve(ok);
          };
        }),
    );
    const src = source(native);
    const events: GnssEvent[] = [];
    const started = src.start((e) => void events.push(e));
    await jest.advanceTimersByTimeAsync(10);
    // The system dialog pauses the activity: suspend, then resume when it closes.
    await src.suspend();
    const resumed = src.resume();
    grant(true);
    await jest.advanceTimersByTimeAsync(8000);
    await Promise.all([started, resumed]);
    expect(native.open).toHaveBeenCalledTimes(1);
    expect(native.cliCommands).toEqual(['version', 'gpspassthrough']);
    const connection = events.filter((e) => e.t === 'connection').at(-1);
    expect(connection).toMatchObject({ state: { kind: 'receiving' } });
  });

  it('reconnects when the board re-enumerates during connection (field report)', async () => {
    const native = new FakeUsbNative({ ...BE122_SIM, flightController: BETAFLIGHT_45 }, FC_DEVICE);
    native.devices[0].hasPermission = true;
    const asked: string[] = [];
    const src = new UsbSerialSource({
      device: native.devices[0],
      native: native as unknown as UsbSerialModule,
      baud: 'auto',
      probeUbx: true,
      setDtrRts: true,
      listenMs: 50,
      probeMs: 50,
      fcListenMs: 200,
      recoverDelayMs: 100,
      confirmPassthrough: async (info) => {
        asked.push(info.name);
        return true;
      },
    });
    const events: GnssEvent[] = [];
    const started = src.start((e) => void events.push(e));
    await jest.advanceTimersByTimeAsync(50); // port open, listening
    native.reenumerate();
    await jest.advanceTimersByTimeAsync(10_000);
    await started;
    expect(native.open).toHaveBeenCalledTimes(2);
    expect(asked).toEqual(['Betaflight']); // asked once, on the stable port
    expect(native.cliCommands).toEqual(['version', 'gpspassthrough']);
    const states = events.filter((e) => e.t === 'connection').map((e) => e.state);
    expect(states.some((st) => st.kind === 'error')).toBe(false);
    expect(states.at(-1)).toEqual({ kind: 'receiving' });
  });

  it('recovers from an I/O error while the device stays attached, and gives up after repeats', async () => {
    const native = new FakeUsbNative(BE122_SIM);
    native.devices[0].hasPermission = true;
    const src = new UsbSerialSource({
      device: native.devices[0],
      native: native as unknown as UsbSerialModule,
      baud: 57600,
      probeUbx: true,
      setDtrRts: true,
      listenMs: 50,
      probeMs: 50,
      recoverDelayMs: 100,
    });
    const events: GnssEvent[] = [];
    const started = src.start((e) => void events.push(e));
    await jest.advanceTimersByTimeAsync(3000);
    await started;
    native.ioError();
    await jest.advanceTimersByTimeAsync(3000);
    const last = () => events.filter((e) => e.t === 'connection').at(-1);
    expect(last()).toMatchObject({ state: { kind: 'receiving' } });
    expect(native.open).toHaveBeenCalledTimes(2);

    // Errors before data flows again count as repeats: the fourth in a row is reported.
    // Each error hits the reopened port while it is still detecting (recover 100 ms, then open).
    for (let i = 0; i < 4; i++) {
      native.ioError();
      await jest.advanceTimersByTimeAsync(120);
    }
    await jest.advanceTimersByTimeAsync(3000);
    expect(events.some((e) => e.t === 'connection' && e.state.kind === 'error')).toBe(true);
  });

  it('renders received bytes readably', () => {
    expect(printable(Uint8Array.of(0x0d, 0x0a, 0x23, 0x20, 0x00, 0xb5))).toBe('⏎# \\x00\\xB5');
  });
});

describe('configuration behind a flight controller (REQ-SER-18)', () => {
  it('blocks baud-rate changes', () => {
    const values = new Map([
      [KEY.UART1_BAUDRATE, 115200],
      [KEY.UART1INPROT_UBX, 1],
      [KEY.UART1OUTPROT_UBX, 1],
    ]);
    expect(checkRules(values, 'UART1', undefined, { lockedBaud: 115200 })).toEqual([]);
    expect(
      checkRules(new Map([...values, [KEY.UART1_BAUDRATE, 38400]]), 'UART1', undefined, {
        lockedBaud: 115200,
      }).map((f) => [f.id, f.severity]),
    ).toEqual([['baudLocked', 'error']]);
  });
});
