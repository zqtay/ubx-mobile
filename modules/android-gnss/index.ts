import { NativeModule, requireOptionalNativeModule } from 'expo';

/** Raw payloads of the `android-gnss` native module (technical spec §5.1). */

export interface AndroidGnssStartOptions {
  /** Location update interval, default 1000. */
  minTimeMs?: number;
  /** Register OnNmeaMessageListener, default true. */
  nmea?: boolean;
  /** Batch NMEA lines for this long before emitting, default 200. */
  nmeaBatchMs?: number;
}

export interface NativeAntennaInfo {
  carrierHz: number;
  pcoXmm: number;
  pcoYmm: number;
  pcoZmm: number;
  pcoXUncMm: number;
  pcoYUncMm: number;
  pcoZUncMm: number;
}

export interface NativeDeviceInfo {
  manufacturer: string;
  model: string;
  androidRelease: string;
  sdkInt: number;
  fingerprint: string;
  hasGnssFeature: boolean;
  /** API 28+. */
  gnssHardwareModelName?: string | null;
  /** API 28+. */
  gnssYearOfHardware?: number | null;
  /** API 30+; only keys the running API supports. */
  capabilities?: Record<string, boolean>;
  /** API 30+, after the first antenna-info callback. */
  antennaInfos?: NativeAntennaInfo[] | null;
}

export interface NativeProviderState {
  locationEnabled: boolean;
  gpsProviderEnabled: boolean;
}

export interface NativeSvStatus {
  /** android.location.GnssStatus.CONSTELLATION_* */
  constellationType: number;
  svid: number;
  cn0DbHz: number;
  elevationDeg: number;
  azimuthDeg: number;
  hasAlmanac: boolean;
  hasEphemeris: boolean;
  usedInFix: boolean;
  /** API 26+, when known. */
  carrierHz?: number;
  /** API 30+, when known. */
  basebandCn0DbHz?: number;
}

export interface NativeLocation {
  lat: number;
  lon: number;
  /** WGS84 ellipsoid height. */
  alt?: number;
  /** API 34+. */
  altMsl?: number;
  acc?: number;
  vAcc?: number;
  speed?: number;
  speedAcc?: number;
  bearing?: number;
  bearingAcc?: number;
  timeMs: number;
  elapsedRealtimeNanos: number;
  isMock: boolean;
}

export type AndroidGnssEvents = {
  onLocation: (location: NativeLocation) => void;
  onGnssStatus: (event: { sats: NativeSvStatus[]; atMs: number }) => void;
  onFirstFix: (event: { ttffMs: number }) => void;
  onGnssStarted: (event: Record<string, never>) => void;
  onGnssStopped: (event: Record<string, never>) => void;
  onNmea: (event: { lines: { timestampMs: number; line: string }[] }) => void;
  onProviderChanged: (state: NativeProviderState) => void;
};

export declare class AndroidGnssModule extends NativeModule<AndroidGnssEvents> {
  hasFineLocationPermission(): boolean;
  getDeviceInfo(): Promise<NativeDeviceInfo>;
  getProviderState(): Promise<NativeProviderState>;
  start(options: AndroidGnssStartOptions): Promise<void>;
  stop(): Promise<void>;
  openLocationSettings(): void;
  openAppSettings(): void;
}

/** Null where the native module is not linked (tests, other platforms). */
const AndroidGnss = requireOptionalNativeModule<AndroidGnssModule>('AndroidGnss');

export default AndroidGnss;
