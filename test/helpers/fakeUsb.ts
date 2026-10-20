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
import { ConfigSim, type SimConfigOptions } from './configSim';

export interface SimReceiver {
  baud: number;
  /** Answers UBX polls (u-blox). */
  ubx: boolean;
  /** Messages it answers with ACK-NAK (unsupported). */
  nak?: (readonly [number, number])[];
  /** Sentences/frames it outputs on its own every `periodMs` (empty = silent). */
  periodic?: () => Uint8Array;
  periodMs?: number;
  /** Simulated configuration database (CFG-VALGET/VALSET/…); absent = config messages unanswered. */
  config?: SimConfigOptions;
  /** The receiver is wired to a Betaflight/INAV flight controller (REQ-SER-15). */
  flightController?: SimFlightController;
}

export interface SimFlightController {
  variant: string;
  version: [number, number, number];
  /** Printed by the CLI `version` command. */
  versionLine: string;
  /** How `gpspassthrough` answers: bridges to the GPS, no GPS port, or an unknown command. */
  gps: 'ok' | 'no-port' | 'unknown';
  /** Passthrough already active when the phone connects (REQ-SER-17). */
  passthrough?: boolean;
  /** How many `#` the board ignores before opening its CLI (Infinity = never). */
  ignoreHash?: number;
}

/** Betaflight 4.5 in front of the BE-122 simulation. */
export const BETAFLIGHT_45: SimFlightController = {
  variant: 'BTFL',
  version: [4, 5, 1],
  versionLine: 'Betaflight / STM32F7X2 (S7X2) 4.5.1 Jul 15 2024 / 10:12:00 (77d01ba3b) MSP API: 1.46',
  gps: 'ok',
};

/** USB descriptor of a flight controller's STM32 virtual COM port. */
export const FC_DEVICE = {
  vendorId: 0x0483,
  productId: 0x5740,
  manufacturerName: 'Betaflight',
  productName: 'Betaflight STM32F7x2',
  driver: 'cdc-acm' as const,
};

const text = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));

function mspReply(command: number, payload: Uint8Array): Uint8Array {
  let sum = payload.length ^ command;
  for (const b of payload) sum ^= b;
  return Uint8Array.of(0x24, 0x4d, 0x3e, payload.length, command, ...payload, sum);
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
  /** Flight controller state: MSP, CLI, or bridging to the GPS. */
  private fcState: 'msp' | 'cli' | 'passthrough' = 'msp';
  private cliLine = '';
  /** CLI commands the flight controller received (REQ-SER-16: only `version`, `gpspassthrough`). */
  cliCommands: string[] = [];
  private ignoredHashes = 0;
  /** MSP commands the flight controller received. */
  mspCommands: number[] = [];
  /** The receiver's configuration database, when `receiver.config` is set. */
  readonly config?: ConfigSim;
  /** A copy: the simulated receiver's baud rate changes with its configuration. */
  receiver: SimReceiver;

  constructor(receiver: SimReceiver, device: Partial<UsbSerialDevice> = {}) {
    this.receiver = { ...receiver };
    if (receiver.flightController?.passthrough) this.fcState = 'passthrough';
    if (receiver.config) {
      this.config = new ConfigSim(receiver.config, (baud) => {
        // undefined = the receiver went silent (garbage at any phone baud rate).
        this.receiver.baud = baud ?? -1;
      });
    }
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
    // Like the native module: a closed session rejects.
    if (!s) throw new Error('Port is not open');
    s.baud = params.baudRate;
    this.restartOutput(sessionId);
  });
  write = jest.fn(async (sessionId: string, dataBase64: string) => {
    const s = this.sessions.get(sessionId);
    if (!s) throw new Error('not open');
    const bytes = base64ToBytes(dataBase64);
    const fc = this.receiver.flightController;
    if (fc && this.fcState !== 'passthrough') {
      this.flightControllerInput(sessionId, fc, bytes);
      return bytes.length;
    }
    for (const f of new StreamDecoder().push(bytes, 0)) {
      if (f.kind !== 'ubx') continue;
      this.written.push({ cls: f.cls, id: f.id, payloadLength: f.payload.length });
      // At the wrong baud rate the receiver hears garbage and stays silent.
      // (Through a flight controller the USB baud is irrelevant: it bridges at the GPS port speed.)
      if ((!fc && s.baud !== this.receiver.baud) || !this.receiver.ubx) continue;
      const configReplies = f.cls === 0x06 ? this.config?.handle(f.id, f.payload) : undefined;
      if (configReplies) {
        for (const r of configReplies) void Promise.resolve().then(() => this.data(sessionId, r));
        continue;
      }
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

  /**
   * Simulates a flight controller pulsing USB at start-up: the open port fails with an I/O error
   * ("Queueing USB request failed"), the device detaches and reappears with a new device ID.
   * Permission is kept (as when the user ticked "Always open UBX Mobile"); the board restarts,
   * so passthrough is off again.
   */
  reenumerate(): void {
    const device = this.devices.shift();
    if (!device) return;
    for (const [id, s] of this.sessions) {
      if (s.deviceId !== device.deviceId) continue;
      if (s.timer) clearInterval(s.timer);
      this.sessions.delete(id);
      this.fire('onError', { sessionId: id, code: 'E_IO', message: 'Queueing USB request failed' });
    }
    this.fire('onDetached', {
      deviceId: device.deviceId,
      vendorId: device.vendorId,
      productId: device.productId,
    });
    const next = { ...device, deviceId: device.deviceId + 1 };
    this.devices.push(next);
    this.fcState = this.receiver.flightController?.passthrough ? 'passthrough' : 'msp';
    this.cliLine = '';
    this.fire('onAttached', next);
  }

  /** Simulates an I/O error on open sessions while the device stays attached. */
  ioError(): void {
    for (const [id, s] of this.sessions) {
      if (s.timer) clearInterval(s.timer);
      this.sessions.delete(id);
      this.fire('onError', { sessionId: id, code: 'E_IO', message: 'Queueing USB request failed' });
    }
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
      const fc = this.receiver.flightController;
      // A flight controller forwards the GPS only in passthrough.
      if (fc && this.fcState !== 'passthrough') return;
      // At the wrong baud the phone receives garbage bytes instead of frames.
      const bytes =
        fc || s.baud === this.receiver.baud ? periodic() : Uint8Array.of(0x00, 0xff, 0x13, 0x88);
      this.data(sessionId, bytes);
    }, periodMs);
  }

  /** Betaflight-like MSP and CLI behaviour before passthrough. */
  private flightControllerInput(sessionId: string, fc: SimFlightController, bytes: Uint8Array): void {
    const send = (reply: Uint8Array) => void Promise.resolve().then(() => this.data(sessionId, reply));
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i];
      if (this.fcState === 'msp') {
        // MSP v1 request without payload: $ M < 0 cmd chk
        if (b === 0x24 && bytes[i + 1] === 0x4d && bytes[i + 2] === 0x3c) {
          const command = bytes[i + 4];
          this.mspCommands.push(command);
          if (command === 1) send(mspReply(1, Uint8Array.of(0, 1, 46)));
          if (command === 2) send(mspReply(2, text(fc.variant)));
          if (command === 3) send(mspReply(3, Uint8Array.from(fc.version)));
          i += 5;
        } else if (b === 0x23) {
          if (this.ignoredHashes < (fc.ignoreHash ?? 0)) {
            this.ignoredHashes += 1;
            continue;
          }
          this.fcState = 'cli';
          send(text("\r\nEntering CLI Mode, type 'exit' to return, or 'help'\r\n\r\n# "));
        }
        continue;
      }
      // CLI: echo, then run the line.
      send(Uint8Array.of(b));
      if (b !== 0x0d && b !== 0x0a) {
        this.cliLine += String.fromCharCode(b);
        continue;
      }
      const line = this.cliLine.trim();
      this.cliLine = '';
      if (!line) continue;
      this.cliCommands.push(line);
      if (line === 'version') {
        send(text(`\r\n# ${fc.versionLine}\r\n\r\n# `));
      } else if (line === 'gpspassthrough' && fc.gps === 'ok') {
        this.fcState = 'passthrough';
        return;
      } else if (line === 'gpspassthrough' && fc.gps === 'no-port') {
        send(text('\r\n###ERROR IN gpspassthrough: GPS forwarding failed###\r\n\r\n# '));
      } else {
        send(text("\r\nUnknown command, try 'help'\r\n\r\n# "));
      }
    }
  }

  private fire<K extends keyof UsbSerialEvents>(
    name: K,
    payload: Parameters<UsbSerialEvents[K]>[0],
  ) {
    for (const fn of this.listeners.get(name) ?? []) (fn as (p: typeof payload) => void)(payload);
  }
}
