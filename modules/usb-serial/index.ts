import { NativeModule, requireOptionalNativeModule } from 'expo';

/** Raw API of the `usb-serial` native module (technical spec §5.2). */

export type UsbDriver = 'cdc-acm' | 'ftdi' | 'cp210x' | 'pl2303' | 'ch34x' | 'unknown';

export interface UsbSerialDevice {
  /** Changes on every replug. */
  deviceId: number;
  deviceName: string;
  vendorId: number;
  productId: number;
  manufacturerName?: string | null;
  productName?: string | null;
  /** Readable only after permission is granted. */
  serialNumber?: string | null;
  driver: UsbDriver;
  portCount: number;
  hasPermission: boolean;
}

export interface UsbOpenOptions {
  portIndex?: number;
  baudRate: number;
  dataBits?: 5 | 6 | 7 | 8;
  stopBits?: 1 | 1.5 | 2;
  parity?: 'none' | 'odd' | 'even' | 'mark' | 'space';
  dtr?: boolean;
  rts?: boolean;
  readFlushMs?: number;
  readFlushBytes?: number;
}

export type UsbLineParameters = Pick<
  UsbOpenOptions,
  'baudRate' | 'dataBits' | 'stopBits' | 'parity'
>;

export type UsbSerialEvents = {
  onData: (event: { sessionId: string; dataBase64: string; bytes: number }) => void;
  onError: (event: { sessionId: string; code: 'E_IO' | 'E_DETACHED'; message: string }) => void;
  onAttached: (device: UsbSerialDevice) => void;
  onDetached: (event: { deviceId: number; vendorId: number; productId: number }) => void;
};

export declare class UsbSerialModule extends NativeModule<UsbSerialEvents> {
  isUsbHostSupported(): boolean;
  listDevices(): Promise<UsbSerialDevice[]>;
  requestPermission(deviceId: number): Promise<boolean>;
  open(deviceId: number, options: UsbOpenOptions): Promise<{ sessionId: string }>;
  setParameters(sessionId: string, params: UsbLineParameters): Promise<void>;
  write(sessionId: string, dataBase64: string): Promise<number>;
  close(sessionId: string): Promise<void>;
  /** Device from the USB_DEVICE_ATTACHED intent that launched the app, if any. */
  getLaunchDevice(): Promise<UsbSerialDevice | null>;
}

/** Null where the native module is not linked (tests, other platforms). */
const UsbSerial = requireOptionalNativeModule<UsbSerialModule>('UsbSerial');

export default UsbSerial;
