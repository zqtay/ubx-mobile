import type { UbxClient } from '@/sources/usb/UbxClient';

import type { CfgPort } from './keys';

/**
 * What the configuration service needs from the connection to a u-blox receiver
 * (technical spec §13.4). Implemented by the USB source.
 */
export interface ReceiverLink {
  /** Port the phone is connected through: decides which port-specific keys are edited. */
  readonly port: CfgPort;
  /** The phone side's current baud rate (UART bridges); undefined for native USB. */
  readonly localBaud: number | undefined;
  readonly client: UbxClient;
  /**
   * The receiver is reached through a flight controller's GPS passthrough: its baud rate is
   * fixed by the flight controller and must not change (REQ-SER-18).
   */
  readonly viaFlightController?: boolean;
  /** Changes the phone side's baud rate without closing the port. */
  setLocalBaud(baud: number): Promise<void>;
  /** Records a confirmed baud change (remembered per device, shown on the Device screen). */
  confirmBaud(baud: number): void;
  /** Clears satellites and TTFF after a receiver restart. */
  restartSession(): void;
  /** Detects the receiver again (after a factory reset the baud rate may have changed). */
  redetect(): Promise<void>;
}
