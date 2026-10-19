import type { EventSubscription } from 'expo-modules-core';

import type { SourceKind, UsbDeviceInfo } from '@/domain/types';
import { base64ToBytes, bytesToBase64 } from '@/protocols/base64';
import { ProtocolPipeline } from '@/protocols/pipeline';
import type { UsbDeviceRef } from '@/state/settingsStore';

import UsbSerialNative, {
  type UsbSerialDevice,
  type UsbSerialModule,
} from '../../../modules/usb-serial';
import type { GnssEventSink, GnssSource } from '../GnssSource';

import { baudCandidates, detectBaud, type DetectionLink } from './detection';
import { UbxClient } from './UbxClient';

const MESSAGES = {
  unsupported: 'This device does not support USB host (OTG).',
  unavailable: 'USB serial is not available in this build.',
  permission: 'USB permission was denied.',
  notFound: 'The USB device is no longer connected.',
  noData:
    'No GNSS data detected. Check the wiring (adapter RX → module TX, TX → RX), the module power and the baud rate.',
  detached: 'USB device disconnected.',
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
  /** Persist the detected baud. */
  onBaudDetected?: (ref: UsbDeviceRef, baud: number) => void;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Detection timings (tests shorten them). */
  listenMs?: number;
  probeMs?: number;
}

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
    const device = (await this.native.listDevices()).find((d) => matchesRef(d, this.ref));
    if (!device) {
      this.emit?.({ t: 'connection', state: { kind: 'disconnected', atMs: this.now() } });
      return;
    }
    await this.connect(device);
  }

  /** Permission → open → detect → poll. */
  private async connect(device: UsbSerialDevice): Promise<void> {
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
    this.emit?.({ t: 'connection', state: { kind: 'detecting' } });

    const result = await detectBaud(this.link(), {
      candidates,
      probeUbx: this.options.probeUbx,
      listenMs: this.options.listenMs,
      probeMs: this.options.probeMs,
    });
    if (!this.sessionId || this.stopped) return;
    if (result.baud === undefined) return this.fail('E_NO_DATA', MESSAGES.noData);

    this.baud = result.baud;
    this.ubx = this.ubx || result.ubx;
    this.detected = true;
    this.detachedAt = undefined;
    this.emit?.({ t: 'usb', patch: { baud: nativeUsb ? undefined : result.baud } });
    if (!nativeUsb) this.options.onBaudDetected?.(this.ref, result.baud);
    if (!this.ubx) this.emit?.({ t: 'receiver', patch: { vendor: 'generic' } });
    const polling = this.ubx && this.options.probeUbx;
    this.emit?.({ t: 'receiver', patch: { dataMode: polling ? 'poll' : 'passive' } });
    this.reportReceiving();

    if (this.ubx && this.options.probeUbx && this.client) {
      const client = this.client;
      await client.pollIdentity();
      if (this.client === client && this.sessionId) client.startScheduler(1000);
    }
  }

  private link(): DetectionLink {
    return {
      setBaud: async (baud) => {
        if (!this.sessionId || !this.native) return;
        await this.native.setParameters(this.sessionId, { baudRate: baud });
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
        const { frames, events } = this.pipeline.push(base64ToBytes(dataBase64), this.now());
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
          this.detachedAt = this.now();
          this.emit?.({ t: 'connection', state: { kind: 'disconnected', atMs: this.detachedAt } });
        } else {
          this.fail('E_IO', message);
        }
      }),
      native.addListener('onAttached', (device) => {
        // Same receiver plugged back in: reconnect without going back to the sheet (REQ-SER-12).
        if (this.stopped || this.sessionId || this.detachedAt === undefined) return;
        if (matchesRef(device, this.ref)) void this.connect(device);
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

  private fail(
    code: 'E_USB_UNSUPPORTED' | 'E_USB_PERMISSION' | 'E_USB_OPEN' | 'E_IO' | 'E_NO_DATA',
    message: string,
  ): void {
    this.emit?.({ t: 'connection', state: { kind: 'error', code, message } });
  }
}
