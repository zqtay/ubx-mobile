/**
 * Normalised GNSS data model (technical spec §4). Every source (phone, USB, replay) is
 * translated into these types, so the UI never sees NMEA, UBX or Android types.
 *
 * Rule: `undefined` means "this source cannot provide the field" (shown as "—");
 * a numeric 0 is a real measured value.
 */

export type Constellation =
  'GPS' | 'SBAS' | 'GALILEO' | 'BEIDOU' | 'QZSS' | 'GLONASS' | 'NAVIC' | 'IMES' | 'UNKNOWN';

/** Stable identity, e.g. "GPS:14", "GLONASS:5", "GLONASS:fcn-3", "QZSS:194" (spec §6.3). */
export type SatKey = string;

export type Health = 'healthy' | 'unhealthy' | 'unknown';

export type OrbitSource =
  'none' | 'ephemeris' | 'almanac' | 'assistnow-offline' | 'assistnow-autonomous' | 'other';

export interface SignalObs {
  /** Normalised signal code, e.g. 'L1CA', 'L2CL', 'L5Q', 'E1C', 'E5bI', 'B1I', 'B2a', 'G1'. */
  code: string;
  /** Human label, e.g. "L1C/A". */
  label: string;
  carrierHz?: number;
  /** dB-Hz; 0 = not tracked. */
  cn0?: number;
  /** UBX qualityInd 0..7. */
  quality?: number;
  /** Used in the navigation solution (UBX prUsed). */
  used?: boolean;
  prResidualM?: number;
  health?: Health;
  /** Correction source name (UBX NAV-SIG corrSource). */
  corrSource?: string;
  /** Monotonic time of the last report, for ageing out lost signals. */
  lastSeenMs?: number;
}

export interface Corrections {
  sbas?: boolean;
  rtcm?: boolean;
  slas?: boolean;
  spartn?: boolean;
  clas?: boolean;
}

/** One satellite as reported by a source at one moment, before merging. */
export interface SatObservation {
  key: SatKey;
  constellation: Constellation;
  /** Constellation-native number (PRN / slot), spec §6.3. */
  svid: number;
  glonassFcn?: number;
  cn0?: number;
  elevation?: number;
  azimuth?: number;
  used?: boolean;
  hasEphemeris?: boolean;
  hasAlmanac?: boolean;
  hasAop?: boolean;
  hasAno?: boolean;
  health?: Health;
  quality?: number;
  prResidualM?: number;
  orbitSource?: OrbitSource;
  diffCorr?: boolean;
  smoothed?: boolean;
  corrections?: Corrections;
  basebandCn0?: number;
  /** Per-signal observations, when the source reports them with the satellite (NMEA 4.10+ GSV, Android). */
  signals?: SignalObs[];
}

export type SatOrigin = 'android' | 'ubx-nav-sat' | 'ubx-nav-svinfo' | 'nmea';

/** A merged satellite as held by the accumulator and shown in the UI. */
export interface Satellite extends Omit<SatObservation, 'signals'> {
  signals: SignalObs[];
  /** Which origin last wrote the satellite-level fields (precedence, spec §7.2). */
  origin: SatOrigin;
  /** Monotonic time of the last report from `origin`. */
  originUpdatedMs: number;
  /** Monotonic time of the last report from any origin. */
  lastSeenMs: number;
}

export type FixType = 'none' | 'dead-reckoning' | '2d' | '3d' | 'gnss-dr' | 'time-only';
export type CarrierSolution = 'none' | 'float' | 'fixed';

export interface UtcTime {
  /** Milliseconds since the Unix epoch. When `dateValid` is false the date part is a guess. */
  epochMs: number;
  dateValid: boolean;
  timeValid: boolean;
  fullyResolved?: boolean;
}

export interface Fix {
  fixType: FixType;
  /** UBX gnssFixOK: the fix is within the receiver's accuracy masks. */
  fixOk?: boolean;
  differential?: boolean;
  carrierSolution?: CarrierSolution;
  lat?: number;
  lon?: number;
  altEllipsoidM?: number;
  altMslM?: number;
  hAccM?: number;
  vAccM?: number;
  speedMps?: number;
  speedAccMps?: number;
  courseDeg?: number;
  courseAccDeg?: number;
  numSvUsed?: number;
  utc?: UtcTime;
  /** Android: location came from a mock provider. */
  isMock?: boolean;
  /** Monotonic receive time of the latest update. */
  receivedAtMs: number;
}

export interface Dop {
  g?: number;
  p?: number;
  t?: number;
  v?: number;
  h?: number;
  n?: number;
  e?: number;
}

export interface SessionInfo {
  startedAtMs: number;
  ttffMs?: number;
  /** 'receiver' = reported by the receiver/OS; 'measured' = time from session start to first fix. */
  ttffSource?: 'receiver' | 'measured';
}

export type NmeaVersion = '2.x' | '2.3+' | '4.10+' | 'unknown';

export type AntennaStatus = 'init' | 'unknown' | 'ok' | 'short' | 'open';
export type AntennaPower = 'off' | 'on' | 'unknown';
export type JammingState = 'unknown' | 'ok' | 'warning' | 'critical';

export interface RfBlockInfo {
  blockId: number;
  antennaStatus?: AntennaStatus;
  antennaPower?: AntennaPower;
  jammingState?: JammingState;
  /** 0..255 */
  jamIndicator?: number;
  noisePerMs?: number;
  /** Automatic gain control, 0..100 %. */
  agcPercent?: number;
}

export type InfoLevel = 'error' | 'warning' | 'notice' | 'debug';

export interface InfoMessage {
  atMs: number;
  level: InfoLevel;
  text: string;
  /** Where it came from, e.g. 'NMEA TXT' or 'UBX-INF-NOTICE'. */
  origin: string;
}

/** Receiver identity and capabilities learned from the data stream (NMEA / UBX). */
export interface ReceiverInfo {
  vendor?: 'u-blox' | 'generic';
  swVersion?: string;
  hwVersion?: string;
  fwVersion?: string;
  protocolVersion?: string;
  module?: string;
  /** Raw MON-VER extension strings. */
  extensions?: string[];
  gnssSupported?: Constellation[];
  gnssDefault?: Constellation[];
  gnssEnabled?: Constellation[];
  maxConcurrentGnss?: number;
  /** Hex string. */
  uniqueId?: string;
  rf?: RfBlockInfo[];
  nmeaVersion?: NmeaVersion;
  talkers?: string[];
  ubxDetected?: boolean;
  nmeaDetected?: boolean;
  infoMessages?: InfoMessage[];
}

/**
 * Everything the Device screen shows. Transport-specific parts (Android phone info,
 * USB descriptor) are added by their sources in M3/M4.
 */
export interface DeviceInfo {
  receiver: ReceiverInfo;
}

export type SourceKind = 'android' | 'usb' | 'replay';

export type SourceErrorCode =
  | 'E_PERMISSION'
  | 'E_PROVIDER_DISABLED'
  | 'E_NO_GNSS_HW'
  | 'E_USB_UNSUPPORTED'
  | 'E_USB_PERMISSION'
  | 'E_USB_OPEN'
  | 'E_IO'
  | 'E_DETACHED'
  | 'E_NO_DATA';

export type ConnectionState =
  | { kind: 'idle' }
  | { kind: 'connecting'; detail?: string }
  | { kind: 'detecting' }
  | { kind: 'receiving' }
  | { kind: 'waiting'; sinceMs: number }
  | { kind: 'disconnected'; atMs: number }
  | { kind: 'error'; code: SourceErrorCode; message: string };

export interface StreamStats {
  bytes: number;
  nmeaFrames: number;
  ubxFrames: number;
  rtcmFrames: number;
  nmeaChecksumErrors: number;
  nmeaNoChecksum: number;
  ubxChecksumErrors: number;
  rtcmCrcErrors: number;
  junkBytes: number;
  /** Monotonic time of the last valid frame. */
  lastFrameMs?: number;
}

export interface GnssSnapshot {
  source: SourceKind | null;
  connection: ConnectionState;
  fix?: Fix;
  dop?: Dop;
  session?: SessionInfo;
  /** Sorted by constellation, then svid. Screens apply their own sort/filter. */
  satellites: Satellite[];
  device: DeviceInfo;
  stats: StreamStats;
  /** True when the source is disconnected/stopped and the data is the last known state. */
  stale: boolean;
}
