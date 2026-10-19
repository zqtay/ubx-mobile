/**
 * In-memory stand-in for the `usb-serial` native module, with a simulated receiver attached.
 * Receivers are modelled on the real modules' configuration dumps (docs/examples):
 * the BE-122 is silent at 57600 baud and only answers UBX polls; the BZ-251 streams NMEA and
 * NAV-PVT at 115200.
 */
import { base64ToBytes, bytesToBase64 } from '@/protocols/base64';
import { concat } from '@/protocols/bytes';
import { withChecksum } from '@/protocols/nmea/checksum';
import { StreamDecoder } from '@/protocols/stream/StreamDecoder';
import { buildUbx } from '@/protocols/ubx/builder';
import {
  M10_MON_VER,
  monGnss,
  monRf,
  navDop,
  navPvt,
  navSat,
  navSig,
  navStatus,
  secUniqId,
} from '@/protocols/ubx/encoders';
import { UBX } from '@/protocols/ubx/ids';

import type { UsbOpenOptions, UsbSerialDevice, UsbSerialEvents } from '../../modules/usb-serial';

export interface SimReceiver {
  baud: number;
  /** Answers UBX polls (u-blox). */
  ubx: boolean;
  /** Messages it answers with ACK-NAK (unsupported). */
  nak?: (readonly [number, number])[];
  /** Sentences/frames it outputs on its own every `periodMs` (empty = silent). */
  periodic?: () => Uint8Array;
  periodMs?: number;
}

const ascii = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const nmea = (body: string) => ascii(`${withChecksum(body)}\r\n`);

export const BE122_SIM: SimReceiver = { baud: 57600, ubx: true };

export const BZ251_SIM: SimReceiver = {
  baud: 115200,
  ubx: true,
  periodMs: 100,
  periodic: () =>
    concat(
      nmea('GNRMC,113902.00,A,0121.12500,N,10349.19000,E,0.025,,181026,,,A,V'),
      nmea('GNGGA,113902.00,0121.12500,N,10349.19000,E,1,05,0.78,32.4,M,7.5,M,,'),
      navPvt(),
    ),
};

export const GENERIC_NMEA_SIM: SimReceiver = {
  baud: 9600,
  ubx: false,
  periodMs: 40,
  periodic: () =>
    concat(
      nmea('GPRMC,113902.00,A,0121.12500,N,10349.19000,E,0.025,,181026,,,A'),
      nmea('GPGGA,113902.00,0121.12500,N,10349.19000,E,1,05,0.78,32.4,M,7.5,M,,'),
      nmea('GPGSV,1,1,02,14,07,312,25,17,34,257,19'),
    ),
};

function response(cls: number, id: number): Uint8Array | undefined {
  const is = (m: readonly [number, number]) => m[0] === cls && m[1] === id;
  if (is(UBX.MON_VER)) return M10_MON_VER();
  if (is(UBX.SEC_UNIQID)) return secUniqId([0x9a, 0x3c, 0x51, 0x07, 0xe2]);
  if (is(UBX.MON_GNSS)) return monGnss(0x0f, 0x0d, 0x0d, 4);
  if (is(UBX.MON_RF)) return monRf([{ antStatus: 2, antPower: 1 }]);
  if (is(UBX.NAV_PVT)) return navPvt({ numSV: 9 });
  if (is(UBX.NAV_SAT))
    return navSat([
      { gnssId: 0, svId: 14, cno: 41, elev: 47, azim: 312, used: true },
      { gnssId: 2, svId: 16, cno: 30, elev: 12, azim: 304, used: true },
    ]);
  if (is(UBX.NAV_SIG)) return navSig([{ gnssId: 0, svId: 14, sigId: 0, cno: 41, prUsed: true }]);
  if (is(UBX.NAV_DOP)) return navDop();
  if (is(UBX.NAV_STATUS)) return navStatus(26_000);
  return undefined;
}

type Listener = (payload: never) => void;

export class FakeUsbNative {
  devices: UsbSerialDevice[];
  /** Whether the user grants USB permission when asked. */
  grantPermission = true;
  hostSupported = true;
  /** Every frame the app wrote, as decoded (cls, id, payload length). */
  written: { cls: number; id: number; payloadLength: number }[] = [];
  openCalls: { deviceId: number; options: UsbOpenOptions }[] = [];

  private listeners = new Map<string, Listener[]>();
  private sessions = new Map<
    string,
    { deviceId: number; baud: number; timer?: ReturnType<typeof setInterval> }
  >();
  private nextSession = 1;

  constructor(
    public receiver: SimReceiver,
    device: Partial<UsbSerialDevice> = {},
  ) {
    this.devices = [
      {
        deviceId: 1002,
        deviceName: '/dev/bus/usb/001/002',
        vendorId: 0x10c4,
        productId: 0xea60,
        manufacturerName: 'Silicon Labs',
        productName: 'CP2102 USB to UART Bridge Controller',
        serialNumber: null,
        driver: 'cp210x',
        portCount: 1,
        hasPermission: false,
        ...device,
      },
    ];
  }

  // ---- UsbSerialModule API
  isUsbHostSupported = () => this.hostSupported;
  listDevices = jest.fn(async () =>
    this.devices.map((d) => ({
      ...d,
      serialNumber: d.hasPermission ? (d.serialNumber ?? null) : null,
    })),
  );
  requestPermission = jest.fn(async (deviceId: number) => {
    const d = this.devices.find((x) => x.deviceId === deviceId);
    if (d && this.grantPermission) d.hasPermission = true;
    return !!d && this.grantPermission;
  });
  open = jest.fn(async (deviceId: number, options: UsbOpenOptions) => {
    this.openCalls.push({ deviceId, options });
    const sessionId = `s${this.nextSession++}`;
    this.sessions.set(sessionId, { deviceId, baud: options.baudRate });
    this.restartOutput(sessionId);
    return { sessionId };
  });
  setParameters = jest.fn(async (sessionId: string, params: { baudRate: number }) => {
    const s = this.sessions.get(sessionId);
    if (s) s.baud = params.baudRate;
    this.restartOutput(sessionId);
  });
  write = jest.fn(async (sessionId: string, dataBase64: string) => {
    const s = this.sessions.get(sessionId);
    if (!s) throw new Error('not open');
    const bytes = base64ToBytes(dataBase64);
    for (const f of new StreamDecoder().push(bytes, 0)) {
      if (f.kind !== 'ubx') continue;
      this.written.push({ cls: f.cls, id: f.id, payloadLength: f.payload.length });
      // At the wrong baud rate the receiver hears garbage and stays silent.
      if (s.baud !== this.receiver.baud || !this.receiver.ubx) continue;
      const nak = this.receiver.nak?.some(([c, i]) => c === f.cls && i === f.id);
      const reply = nak ? buildUbx(0x05, 0x00, Uint8Array.of(f.cls, f.id)) : response(f.cls, f.id);
      // A plain promise, not queueMicrotask: Jest's fake timers would hold that back.
      if (reply) void Promise.resolve().then(() => this.data(sessionId, reply));
    }
    return bytes.length;
  });
  close = jest.fn(async (sessionId: string) => {
    const s = this.sessions.get(sessionId);
    if (s?.timer) clearInterval(s.timer);
    this.sessions.delete(sessionId);
  });
  getLaunchDevice = jest.fn(async () => null);

  addListener<K extends keyof UsbSerialEvents>(name: K, fn: UsbSerialEvents[K]) {
    const list = this.listeners.get(name) ?? [];
    list.push(fn as Listener);
    this.listeners.set(name, list);
    return {
      remove: () =>
        this.listeners.set(
          name,
          (this.listeners.get(name) ?? []).filter((f) => f !== fn),
        ),
    };
  }

  // ---- simulation helpers
  get openSessions(): number {
    return this.sessions.size;
  }

  /** Simulates unplugging the device. */
  unplug(): void {
    const device = this.devices.shift();
    if (!device) return;
    for (const [id, s] of this.sessions) {
      if (s.deviceId !== device.deviceId) continue;
      if (s.timer) clearInterval(s.timer);
      this.sessions.delete(id);
      this.fire('onError', { sessionId: id, code: 'E_DETACHED', message: 'USB device detached' });
    }
    this.fire('onDetached', {
      deviceId: device.deviceId,
      vendorId: device.vendorId,
      productId: device.productId,
    });
    this.unplugged = device;
  }

  /** Simulates plugging the same device back in (new deviceId, permission must be re-granted). */
  replug(): void {
    if (!this.unplugged) return;
    const device = {
      ...this.unplugged,
      deviceId: this.unplugged.deviceId + 1,
      hasPermission: false,
    };
    this.unplugged = undefined;
    this.devices.push(device);
    this.fire('onAttached', device);
  }

  private unplugged?: UsbSerialDevice;

  private data(sessionId: string, bytes: Uint8Array): void {
    if (!this.sessions.has(sessionId)) return;
    this.fire('onData', { sessionId, dataBase64: bytesToBase64(bytes), bytes: bytes.length });
  }

  private restartOutput(sessionId: string): void {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    if (s.timer) clearInterval(s.timer);
    s.timer = undefined;
    const { periodic, periodMs } = this.receiver;
    if (!periodic || !periodMs) return;
    s.timer = setInterval(() => {
      // At the wrong baud the phone receives garbage bytes instead of frames.
      const bytes =
        s.baud === this.receiver.baud ? periodic() : Uint8Array.of(0x00, 0xff, 0x13, 0x88);
      this.data(sessionId, bytes);
    }, periodMs);
  }

  private fire<K extends keyof UsbSerialEvents>(
    name: K,
    payload: Parameters<UsbSerialEvents[K]>[0],
  ) {
    for (const fn of this.listeners.get(name) ?? []) (fn as (p: typeof payload) => void)(payload);
  }
}
