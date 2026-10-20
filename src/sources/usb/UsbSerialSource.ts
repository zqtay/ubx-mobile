import type { EventSubscription } from 'expo-modules-core';

import type { SourceKind, UsbDeviceInfo } from '@/domain/types';
import { base64ToBytes, bytesToBase64 } from '@/protocols/base64';
import { ProtocolPipeline } from '@/protocols/pipeline';

import type { UsbDeviceRef } from '@/state/settingsStore';

import type { ReceiverLink } from '@/config/link';

import UsbSerialNative, {
  type UsbSerialDevice,
  type UsbSerialModule,
} from '../../../modules/usb-serial';
import type { GnssEventSink, GnssSource } from '../GnssSource';

import { logDiagnostic } from '@/state/diagnostics';

import { baudCandidates, detectBaud, type DetectionLink } from './detection';
import {
  enablePassthrough,
  identifyFlightController,
  isFlightControllerUsb,
  supportsPassthrough,
  type FcLink,
  type FlightControllerInfo,
} from './flightController';
import { UbxClient } from './UbxClient';
import { enablePeriodicOutput } from './periodicOutput';

const MESSAGES = {
  unsupported: 'This device does not support USB host (OTG).',
  unavailable: 'USB serial is not available in this build.',
  permission: 'USB permission was denied.',
  notFound: 'The USB device is no longer connected.',
  noData:
    'No GNSS data detected. Check the wiring (adapter RX → module TX, TX → RX), the module power and the baud rate.',
  detached: 'USB device disconnected.',
  fcDeclined: 'GPS passthrough was not enabled, so the flight controller does not forward its GPS.',
  fcNoData:
    "GPS passthrough is on but the GPS sends nothing. On many flight controllers the GPS pads are powered only from the battery; also check the GPS port in the flight controller's Ports tab.",
};

export interface UsbSourceOptions {
  device: UsbSerialDevice;
  native?: UsbSerialModule | null;
  /** 'auto' or a fixed baud rate (settings → USB). */
  baud: number | 'auto';
  /** Probe silent receivers with UBX polls, and poll UBX data (REQ-SER-08). */
  probeUbx: boolean;
  setDtrRts: boolean;
  /** Baud remembered for this device. */
  rememberedBaud?: number;
  /**
   * Enable periodic UBX output in RAM instead of polling (REQ-SER-09; Settings → USB → UBX
   * data mode). Only with probeUbx.
   */
  periodicOutput?: boolean;
  /**
   * Asks the user whether to enable GPS passthrough on a Betaflight/INAV flight controller
   * (REQ-SER-16). Without it, passthrough is never enabled.
   */
  confirmPassthrough?: (fc: FlightControllerInfo) => Promise<boolean>;
  /** Flight controller handshake timing (tests shorten it). */
  fcListenMs?: number;
  /** Wait before reconnecting after an I/O error (tests shorten it). */
  recoverDelayMs?: number;
  /** Persist the detected baud. */
  onBaudDetected?: (ref: UsbDeviceRef, baud: number) => void;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Detection timings (tests shorten them). */
  listenMs?: number;
  probeMs?: number;
}

/** Reconnections after I/O errors before reporting the error (counted until data flows). */
const MAX_RECOVERIES = 3;

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function refOf(
  device: Pick<UsbSerialDevice, 'vendorId' | 'productId' | 'serialNumber'>,
): UsbDeviceRef {
  return {
    vendorId: device.vendorId,
    productId: device.productId,
    ...(device.serialNumber ? { serialNumber: device.serialNumber } : {}),
  };
}

export function matchesRef(device: UsbSerialDevice, ref: UsbDeviceRef): boolean {
  return (
    device.vendorId === ref.vendorId &&
    device.productId === ref.productId &&
    (!ref.serialNumber || device.serialNumber === ref.serialNumber)
  );
}

function usbInfo(device: UsbSerialDevice): UsbDeviceInfo {
  return {
    vendorId: device.vendorId,
    productId: device.productId,
    productName: device.productName ?? undefined,
    manufacturerName: device.manufacturerName ?? undefined,
    serialNumber: device.serialNumber ?? undefined,
    deviceName: device.deviceName,
    driver: device.driver,
    portIndex: 0,
  };
}

/**
 * External receiver over USB serial (REQ-SER-01..14): native USB (CDC-ACM) or a USB-UART bridge
 * such as a CP2102/CH340 adapter wired to a TTL module like the BE-122.
 */
export class UsbSerialSource implements GnssSource {
  readonly kind: SourceKind = 'usb';
  readonly label: string;
  private readonly native: UsbSerialModule | null;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private device: UsbSerialDevice;
  private ref: UsbDeviceRef;

  private emit?: GnssEventSink;
  private subscriptions: EventSubscription[] = [];
  private sessionId?: string;
  private pipeline = new ProtocolPipeline();
  private client?: UbxClient;
  private baud?: number;
  private ubx = false;
  private detected = false;
  private receivingReported = false;
  private detachedAt?: number;
  private stopped = false;
  /** Raw bytes collected for the flight controller handshake (before the protocol pipeline). */
  private raw?: Uint8Array[];
  /** Set when the GPS is reached through a flight controller's passthrough. */
  private flightController?: { name?: string; version?: string; versionLine?: string };

  constructor(private readonly options: UsbSourceOptions) {
    this.native = options.native === undefined ? UsbSerialNative : options.native;
    this.now = options.now ?? (() => Date.now());
    this.sleep = options.sleep ?? defaultSleep;
    this.device = options.device;
    this.ref = refOf(options.device);
    this.label = options.device.productName ?? 'USB receiver';
  }

  async start(emit: GnssEventSink): Promise<void> {
    this.emit = emit;
    this.stopped = false;
    emit({ t: 'connection', state: { kind: 'connecting' } });
    const native = this.native;
    if (!native) return this.fail('E_USB_UNSUPPORTED', MESSAGES.unavailable);
    if (!native.isUsbHostSupported()) return this.fail('E_USB_UNSUPPORTED', MESSAGES.unsupported);

    this.subscribe(native);
    await this.connect(this.device);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    for (const s of this.subscriptions) s.remove();
    this.subscriptions = [];
    await this.closePort();
    this.emit?.({ t: 'connection', state: { kind: 'idle' } });
  }

  /** Background: release the port (REQ-NFR-08). */
  async suspend(): Promise<void> {
    await this.closePort();
  }

  /** Foreground: reopen the same device if it is still attached. */
  async resume(): Promise<void> {
    if (!this.native || this.stopped || this.sessionId) return;
    if (this.connecting) {
      // Reconnect after the running attempt, if it ends without a session.
      this.reconnectPending ??= 'resume';
      return;
    }
    const device = (await this.native.listDevices()).find((d) => matchesRef(d, this.ref));
    if (!device) {
      this.emit?.({ t: 'connection', state: { kind: 'disconnected', atMs: this.now() } });
      return;
    }
    await this.connect(device);
  }

  /**
   * Connection to a u-blox receiver for the configuration feature (technical spec §13), or
   * undefined when not connected to one. Getters always reflect the current session.
   */
  configLink(): ReceiverLink | undefined {
    const native = this.native;
    if (!native || !this.sessionId || !this.client || !this.ubx) return undefined;
    const nativeUsb = this.device.driver === 'cdc-acm';

    const source = this;
    const viaFc = !!source.flightController;
    return {
      // Behind a flight controller the GPS's own UART is configured, not a USB port.
      port: nativeUsb && !viaFc ? 'USB' : 'UART1',
      viaFlightController: viaFc,
      get localBaud() {
        return nativeUsb ? undefined : source.baud;
      },
      get client() {
        if (!source.client) throw new Error('Receiver disconnected');
        return source.client;
      },
      setLocalBaud: async (baud: number) => {
        if (!source.sessionId) return;
        await native.setParameters(source.sessionId, { baudRate: baud });
        source.pipeline.decoder.reset();
      },
      confirmBaud: (baud: number) => {
        source.baud = baud;
        source.emit?.({ t: 'usb', patch: { baud } });
        source.options.onBaudDetected?.(source.ref, baud);
      },
      restartSession: () => source.emit?.({ t: 'session-restart' }),
      redetect: async () => {
        await source.closePort();
        source.baud = undefined;
        await source.connect(source.device);
      },
    };
  }

  private connecting?: Promise<void>;
  /** Reconnect once the running attempt ends without a session: resume, or a re-attached device. */
  private reconnectPending?: UsbSerialDevice | 'resume';
  /** Lost connections in a row without reaching "receiving" (stops endless retries). */
  private lostInARow = 0;

  /**
   * One connection attempt at a time. The USB permission dialog sends the app to the
   * background and back, and resume() must not start a second attempt on the same port while
   * the first is still running (it would interleave both handshakes).
   */
  private connect(device: UsbSerialDevice): Promise<void> {
    if (this.connecting) return this.connecting;
    this.connecting = this.connectOnce(device).finally(() => {
      this.connecting = undefined;
      const pending = this.reconnectPending;
      this.reconnectPending = undefined;
      if (!pending || this.sessionId || this.stopped) return;
      if (pending === 'resume') void this.resume();
      else void this.connect(pending);
    });
    return this.connecting;
  }

  /** Permission → open → detect → poll. */
  private async connectOnce(device: UsbSerialDevice): Promise<void> {
    const native = this.native!;
    const granted = device.hasPermission || (await native.requestPermission(device.deviceId));
    if (!granted) return this.fail('E_USB_PERMISSION', MESSAGES.permission);

    // Manufacturer/serial strings become readable only after permission.
    const refreshed = (await native.listDevices()).find((d) => d.deviceId === device.deviceId);
    if (!refreshed) return this.fail('E_USB_OPEN', MESSAGES.notFound);
    this.device = refreshed;
    this.ref = refOf(refreshed);
    this.emit?.({ t: 'usb', patch: usbInfo(refreshed) });

    const nativeUsb = refreshed.driver === 'cdc-acm';
    let session: string | undefined;
    // The port can vanish mid-attempt (a flight controller re-enumerating at start-up): stop
    // quietly; the error/attach handlers reconnect.
    const lost = () => this.stopped || !session || this.sessionId !== session;
    const candidates = this.baud
      ? [this.baud]
      : baudCandidates({
          remembered: this.options.rememberedBaud,
          setting: this.options.baud,
          nativeUsb,
        });

    try {
      const { sessionId } = await native.open(refreshed.deviceId, {
        baudRate: candidates[0],
        dtr: this.options.setDtrRts,
        rts: this.options.setDtrRts,
      });
      this.sessionId = sessionId;
      session = sessionId;
    } catch (error) {
      const code =
        (error as { code?: string }).code === 'E_USB_PERMISSION'
          ? 'E_USB_PERMISSION'
          : 'E_USB_OPEN';
      return this.fail(code, error instanceof Error ? error.message : String(error));
    }

    this.pipeline = new ProtocolPipeline();
    this.client = new UbxClient((frame) => this.write(frame), { now: this.now });
    this.detected = false;
    this.receivingReported = false;

    // Betaflight/INAV flight controller: GPS passthrough first (REQ-SER-15..17).
    if (isFlightControllerUsb(refreshed)) {
      const proceed = await this.flightControllerStage(lost);
      if (!proceed || lost()) return;
    }
    this.emit?.({ t: 'connection', state: { kind: 'detecting' } });

    const result = await detectBaud(this.link(), {
      candidates,
      probeUbx: this.options.probeUbx,
      listenMs: this.options.listenMs,
      probeMs: this.options.probeMs,
    });
    if (lost()) return;
    if (result.baud === undefined) {
      return this.fail('E_NO_DATA', this.flightController ? MESSAGES.fcNoData : MESSAGES.noData);
    }

    this.baud = result.baud;
    this.ubx = this.ubx || result.ubx;
    this.detected = true;
    this.detachedAt = undefined;
    this.lostInARow = 0;
    this.emit?.({ t: 'usb', patch: { baud: nativeUsb ? undefined : result.baud } });
    if (!nativeUsb) this.options.onBaudDetected?.(this.ref, result.baud);
    if (!this.ubx) this.emit?.({ t: 'receiver', patch: { vendor: 'generic' } });
    const polling = this.ubx && this.options.probeUbx;
    this.emit?.({ t: 'receiver', patch: { dataMode: polling ? 'poll' : 'passive' } });
    this.reportReceiving();

    if (this.ubx && this.options.probeUbx && this.client) {
      const client = this.client;
      await client.pollIdentity();
      if (this.options.periodicOutput && this.client === client && this.sessionId) {
        const result = await enablePeriodicOutput(client, nativeUsb ? 'USB' : 'UART1');
        if (result === 'enabled' || result === 'already') {
          this.emit?.({ t: 'receiver', patch: { dataMode: 'periodic' } });
        }
      }
      // Polling continues for whatever is not output periodically (the scheduler skips the rest).
      if (this.client === client && this.sessionId) client.startScheduler(1000);
    }
  }

  private link(): DetectionLink {
    return {
      setBaud: async (baud) => {
        if (!this.sessionId || !this.native) return;
        // The port may have closed under us (I/O error); the error handler reports or recovers.
        await this.native.setParameters(this.sessionId, { baudRate: baud }).catch(() => undefined);
        // Bytes buffered at the previous rate are garbage now.
        this.pipeline.decoder.reset();
      },
      write: (frame) => this.write(frame),
      validFrames: () =>
        this.pipeline.decoder.stats.nmeaFrames + this.pipeline.decoder.stats.ubxFrames,
      ubxFrames: () => this.pipeline.decoder.stats.ubxFrames,
      sleep: this.sleep,
    };
  }

  private async write(frame: Uint8Array): Promise<void> {
    if (!this.sessionId || !this.native) return;
    await this.native.write(this.sessionId, bytesToBase64(frame));
  }

  private subscribe(native: UsbSerialModule): void {
    this.subscriptions = [
      native.addListener('onData', ({ sessionId, dataBase64 }) => {
        if (sessionId !== this.sessionId) return;
        const bytes = base64ToBytes(dataBase64);
        this.raw?.push(bytes);
        const { frames, events } = this.pipeline.push(bytes, this.now());
        for (const e of events) this.emit?.(e);
        for (const f of frames) {
          if (f.kind === 'ubx') this.ubx = true;
          this.client?.onFrame(f);
        }
        if (frames.length > 0) this.reportReceiving();
      }),
      native.addListener('onError', ({ sessionId, code, message }) => {
        if (sessionId !== this.sessionId) return;
        this.dropSession();
        if (code === 'E_DETACHED') {
          this.markDetached();
        } else {
          void this.recoverFromIoError(message);
        }
      }),
      native.addListener('onDetached', (device) => {
        // After an I/O error the session is already closed, so no E_DETACHED arrives for it.
        if (
          !this.sessionId &&
          device.vendorId === this.ref.vendorId &&
          device.productId === this.ref.productId
        ) {
          this.markDetached();
        }
      }),
      native.addListener('onAttached', (device) => {
        // Same receiver plugged back in (or re-enumerated with a new device ID): reconnect
        // without going back to the sheet (REQ-SER-12).
        if (this.stopped || this.sessionId || this.detachedAt === undefined) return;
        if (!matchesRef(device, this.ref)) return;
        if (this.connecting) this.reconnectPending = device;
        else void this.connect(device);
      }),
    ];
  }

  private reportReceiving(): void {
    if (!this.detected || this.receivingReported) return;
    this.receivingReported = true;
    this.emit?.({ t: 'connection', state: { kind: 'receiving' } });
  }

  private dropSession(): void {
    this.client?.dispose();
    this.client = undefined;
    this.sessionId = undefined;
  }

  private async closePort(): Promise<void> {
    const id = this.sessionId;
    this.dropSession();
    if (id && this.native) await this.native.close(id).catch(() => undefined);
  }

  private markDetached(): void {
    if (this.detachedAt !== undefined && !this.sessionId) return;
    this.detachedAt = this.now();
    // Unplugging powers a flight controller down: passthrough must be enabled again.
    this.flightController = undefined;
    this.emit?.({ t: 'connection', state: { kind: 'disconnected', atMs: this.detachedAt } });
  }

  /**
   * An I/O error usually means the device went away, often only briefly: Betaflight pulses the
   * USB data line at start-up and re-enumerates with a new device ID. Treat it as a disconnect
   * and reconnect when the device is (still or again) present; give up after a few attempts.
   */
  private async recoverFromIoError(message: string): Promise<void> {
    this.lostInARow += 1;
    if (this.lostInARow > MAX_RECOVERIES || !this.native) {
      this.fail('E_IO', message);
      return;
    }
    this.markDetached();
    await this.sleep(this.options.recoverDelayMs ?? 1500);
    if (this.stopped || this.sessionId) return;
    const device = (await this.native.listDevices()).find((d) => matchesRef(d, this.ref));
    // Not listed (yet): the attach handler reconnects when it reappears.
    if (!device) return;
    if (this.connecting) this.reconnectPending = device;
    else await this.connect(device);
  }

  /**
   * Flight controller stage (technical spec §16). Returns false when the connection stops here
   * (declined, or the flight controller refused passthrough).
   */
  private async flightControllerStage(lost: () => boolean): Promise<boolean> {
    // Same connection (resume, re-detection after a factory reset): passthrough is still on.
    if (this.flightController) return true;
    this.emit?.({ t: 'connection', state: { kind: 'connecting', detail: 'Flight controller' } });
    // Already passing GNSS data through (e.g. the app was reopened): use it directly.
    await this.sleep(this.options.fcListenMs ?? 1000);
    if (lost()) return false;
    const stats = this.pipeline.decoder.stats;
    if (stats.nmeaFrames + stats.ubxFrames > 0) {
      this.flightController = {};
      this.emit?.({ t: 'usb', patch: { flightController: { passthrough: true } } });
      return true;
    }

    this.raw = [];
    try {
      const link = this.fcLink();
      const info = await identifyFlightController(link);
      // No answer because the port went away is not "passthrough already on".
      if (lost()) return false;
      if (!info) {
        // A Betaflight/INAV board always answers MSP, unless it is already bridging to the GPS
        // (e.g. a GPS that only answers polls, like the BE-122): treat it as passthrough.
        this.flightController = {};
        this.emit?.({ t: 'usb', patch: { flightController: { passthrough: true } } });
        return true;
      }
      if (!supportsPassthrough(info)) return true; // another firmware: plain detection
      const allowed = (await this.options.confirmPassthrough?.(info)) ?? false;
      if (lost()) return false;
      if (!allowed) {
        this.fail('E_FC_DECLINED', MESSAGES.fcDeclined);
        return false;
      }
      const result = await enablePassthrough(link, info);
      if (lost()) return false;
      logDiagnostic({
        level: result.ok ? 'info' : 'error',
        area: 'fc',
        message: result.ok
          ? `${info.name} ${info.version ?? ''}: GPS passthrough enabled`
          : `${info.name} ${info.version ?? ''}: ${result.message}`,
        details: result.transcript.join('\n'),
      });
      if (!result.ok) {
        this.fail('E_FC_PASSTHROUGH', `${info.name}: ${result.message}`);
        return false;
      }
      this.flightController = {
        name: info.name,
        version: info.version,
        versionLine: result.versionLine,
      };
      this.emit?.({
        t: 'usb',
        patch: { flightController: { ...this.flightController, passthrough: true } },
      });
      // The CLI text counted as junk: start the GNSS statistics afresh.
      this.pipeline = new ProtocolPipeline();
      return true;
    } finally {
      this.raw = undefined;
    }
  }

  private fcLink(): FcLink {
    return {
      write: (bytes) => this.write(bytes),
      received: () => {
        const chunks = this.raw ?? [];
        const all = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
        let o = 0;
        for (const c of chunks) {
          all.set(c, o);
          o += c.length;
        }
        return all;
      },
      clear: () => {
        if (this.raw) this.raw = [];
      },
      sleep: this.sleep,
    };
  }

  private fail(
    code:
      | 'E_USB_UNSUPPORTED'
      | 'E_USB_PERMISSION'
      | 'E_USB_OPEN'
      | 'E_IO'
      | 'E_NO_DATA'
      | 'E_FC_DECLINED'
      | 'E_FC_PASSTHROUGH',
    message: string,
  ): void {
    this.emit?.({ t: 'connection', state: { kind: 'error', code, message } });
  }
}
