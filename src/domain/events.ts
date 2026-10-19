import type {
  AndroidDeviceInfo,
  ConnectionState,
  UsbDeviceInfo,
  Constellation,
  Dop,
  Fix,
  InfoLevel,
  ReceiverInfo,
  SatKey,
  SatObservation,
  SatOrigin,
  SignalObs,
  StreamStats,
} from './types';

/** Who produced a fix / DOP update; used for precedence (technical spec §7.2). */
export type FixOrigin = 'android' | 'ubx' | 'nmea';
export type DopOrigin = 'android-nmea' | 'ubx' | 'nmea';

/**
 * Normalised events emitted by sources and protocol interpreters (technical spec §7.1).
 * The accumulator is the only consumer; the UI never sees these directly.
 */
export type GnssEvent =
  /** Partial fix update; fields not present are left unchanged. */
  | { t: 'fix'; fix: Partial<Omit<Fix, 'receivedAtMs'>>; origin: FixOrigin }
  | { t: 'dop'; dop: Dop; origin: DopOrigin }
  /**
   * A set of satellite observations. `scope` describes what the set covers (e.g. 'all' for a
   * complete NAV-SAT, or a GSV group key); satellites missing from it age out by timeout.
   */
  | { t: 'satellites'; origin: SatOrigin; scope: string; sats: SatObservation[] }
  /** Per-signal observations (UBX NAV-SIG); replaces each listed satellite's signal list. */
  | {
      t: 'signals';
      signals: ({
        key: SatKey;
        constellation: Constellation;
        svid: number;
        glonassFcn?: number;
      } & SignalObs)[];
    }
  /** Used-in-fix set from NMEA GSA. With scope 'all', satellites not listed are not used. */
  | { t: 'used'; scope: 'all' | Constellation; keys: SatKey[] }
  /** Time to first fix as reported by the receiver / OS. */
  | { t: 'ttff'; ms: number }
  | { t: 'receiver'; patch: Partial<ReceiverInfo> }
  /** Phone details from the Android source. */
  | { t: 'android'; patch: Partial<AndroidDeviceInfo> }
  /** USB descriptor and line settings from the USB source. */
  | { t: 'usb'; patch: Partial<UsbDeviceInfo> }
  | { t: 'info'; level: InfoLevel; text: string; origin: string }
  | { t: 'connection'; state: ConnectionState }
  /** The receiver was restarted (hot/warm/cold): clear satellites and TTFF (REQ-CFG-14). */
  | { t: 'session-restart' }
  | { t: 'stats'; stats: StreamStats };
