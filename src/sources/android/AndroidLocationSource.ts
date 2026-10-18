import type { EventSubscription } from 'expo-modules-core';

import type { GnssEvent } from '@/domain/events';
import { fromAndroid, keyOf } from '@/domain/satKey';
import { bandFromCarrier, isSecondFrequency } from '@/domain/signals';
import type { AndroidDeviceInfo, Constellation, SatObservation, SignalObs, SourceKind } from '@/domain/types';
import { NmeaInterpreter } from '@/protocols/nmea/interpreter';

import AndroidGnssNative, {
  type AndroidGnssModule,
  type NativeDeviceInfo,
  type NativeLocation,
  type NativeSvStatus,
} from '../../../modules/android-gnss';
import type { GnssEventSink, GnssSource } from '../GnssSource';

import { expoLocationPermissions, type PermissionGateway } from './permissions';

/** Messages for error banners; the UI maps the code to an action (functional spec §10). */
const MESSAGES = {
  unavailable: 'Phone GNSS is not available in this build.',
  noGnss: 'This device has no GNSS receiver.',
  denied: 'Location permission is needed to read satellite data from your phone.',
  blocked: 'Location permission was denied. Enable it in the app settings.',
  approximate: 'Precise location is needed for satellite data. Allow precise location in the app settings.',
  locationOff: 'Location is turned off. Turn it on to receive satellite data.',
};

/** Unknown-position rule for Android (functional spec §4.5). */
function hasUnknownPosition(s: NativeSvStatus): boolean {
  return !s.hasAlmanac && !s.hasEphemeris && s.elevationDeg === 0 && s.azimuthDeg === 0;
}

/**
 * Groups GnssStatus entries into satellites. Dual-frequency phones report one entry per signal
 * of the same SV (REQ-AND-07); these become one satellite with several signals.
 */
export function satellitesFromStatus(entries: readonly NativeSvStatus[], atMs: number): SatObservation[] {
  const bySat = new Map<string, { obs: SatObservation; signals: SignalObs[] }>();
  for (const e of entries) {
    const id = fromAndroid(e.constellationType, e.svid);
    const key = keyOf(id);
    let entry = bySat.get(key);
    if (!entry) {
      const unknown = hasUnknownPosition(e);
      entry = {
        obs: {
          key,
          ...id,
          cn0: 0,
          elevation: unknown ? undefined : Math.round(e.elevationDeg),
          azimuth: unknown ? undefined : Math.round(e.azimuthDeg),
          used: false,
          hasAlmanac: false,
          hasEphemeris: false,
        },
        signals: [],
      };
      bySat.set(key, entry);
    }
    const { obs } = entry;
    obs.cn0 = Math.max(obs.cn0 ?? 0, e.cn0DbHz);
    obs.used = obs.used || e.usedInFix;
    obs.hasAlmanac = obs.hasAlmanac || e.hasAlmanac;
    obs.hasEphemeris = obs.hasEphemeris || e.hasEphemeris;
    if (obs.elevation === undefined && !hasUnknownPosition(e)) {
      obs.elevation = Math.round(e.elevationDeg);
      obs.azimuth = Math.round(e.azimuthDeg);
    }
    if (e.basebandCn0DbHz !== undefined) {
      obs.basebandCn0 = Math.max(obs.basebandCn0 ?? -Infinity, e.basebandCn0DbHz);
    }
    if (e.carrierHz !== undefined) {
      const band = bandFromCarrier(id.constellation, e.carrierHz);
      entry.signals.push({
        code: band?.code ?? `${Math.round(e.carrierHz / 1e4) / 100} MHz`,
        label: band?.label ?? `${(e.carrierHz / 1e6).toFixed(2)} MHz`,
        carrierHz: e.carrierHz,
        cn0: e.cn0DbHz,
        used: e.usedInFix,
        lastSeenMs: atMs,
      });
    }
  }
  return [...bySat.values()].map(({ obs, signals }) => (signals.length > 0 ? { ...obs, signals } : obs));
}

/** Location → partial fix. Android's altitude is the WGS84 ellipsoid height. */
export function fixFromLocation(l: NativeLocation): Extract<GnssEvent, { t: 'fix' }>['fix'] {
  return {
    fixType: l.alt !== undefined ? '3d' : '2d',
    lat: l.lat,
    lon: l.lon,
    altEllipsoidM: l.alt,
    altMslM: l.altMsl,
    hAccM: l.acc,
    vAccM: l.vAcc,
    speedMps: l.speed,
    speedAccMps: l.speedAcc,
    courseDeg: l.bearing,
    courseAccDeg: l.bearingAcc,
    utc: { epochMs: l.timeMs, dateValid: true, timeValid: true },
    isMock: l.isMock,
  };
}

function deviceFromNative(info: NativeDeviceInfo): Partial<AndroidDeviceInfo> {
  return {
    manufacturer: info.manufacturer,
    model: info.model,
    androidRelease: info.androidRelease,
    sdkInt: info.sdkInt,
    fingerprint: info.fingerprint,
    hasGnssFeature: info.hasGnssFeature,
    gnssHardwareModelName: info.gnssHardwareModelName ?? undefined,
    gnssYearOfHardware: info.gnssYearOfHardware ?? undefined,
    capabilities: info.capabilities,
    antennaInfos: info.antennaInfos ?? undefined,
  };
}

export interface AndroidLocationSourceOptions {
  native?: AndroidGnssModule | null;
  permissions?: PermissionGateway;
  /** Monotonic clock, injectable for tests. */
  now?: () => number;
}

/**
 * The phone's built-in GNSS receiver via Android Location APIs (REQ-AND-01..08).
 * GnssStatus and Location are authoritative; the phone's NMEA only fills DOP and MSL altitude.
 */
export class AndroidLocationSource implements GnssSource {
  readonly kind: SourceKind = 'android';
  readonly label = 'Phone';
  private readonly native: AndroidGnssModule | null;
  private readonly permissions: PermissionGateway;
  private readonly now: () => number;

  private emit?: GnssEventSink;
  private subscriptions: EventSubscription[] = [];
  private nmea = new NmeaInterpreter('android');
  private running = false;
  private waitingForProvider = false;
  private gotData = false;
  private hasMslFromLocation = false;
  private observed = { constellations: new Set<Constellation>(), bands: new Set<string>(), maxSvUsed: 0, nmea: false };
  private counts = { location: 0, status: 0 };
  private lastObservedReport = '';

  constructor(options: AndroidLocationSourceOptions = {}) {
    this.native = options.native === undefined ? AndroidGnssNative : options.native;
    this.permissions = options.permissions ?? expoLocationPermissions;
    this.now = options.now ?? (() => Date.now());
  }

  async start(emit: GnssEventSink): Promise<void> {
    this.emit = emit;
    emit({ t: 'connection', state: { kind: 'connecting' } });
    const native = this.native;
    if (!native) return this.fail('E_NO_GNSS_HW', MESSAGES.unavailable);

    const permission = await this.permissions.request();
    if (permission !== 'granted') {
      return this.fail('E_PERMISSION', MESSAGES[permission]);
    }

    const info = await native.getDeviceInfo();
    emit({ t: 'android', patch: { ...deviceFromNative(info), observed: this.observedInfo(), locationUpdates: 0, statusUpdates: 0 } });
    if (!info.hasGnssFeature) return this.fail('E_NO_GNSS_HW', MESSAGES.noGnss);

    this.subscribe(native);
    const provider = await native.getProviderState();
    if (!provider.locationEnabled || !provider.gpsProviderEnabled) {
      this.waitingForProvider = true;
      return this.fail('E_PROVIDER_DISABLED', MESSAGES.locationOff);
    }
    await this.startNative();
  }

  async stop(): Promise<void> {
    for (const s of this.subscriptions) s.remove();
    this.subscriptions = [];
    await this.stopNative();
    this.emit?.({ t: 'connection', state: { kind: 'idle' } });
  }

  /** Background: stop GNSS so the location indicator turns off (REQ-AND-08). */
  async suspend(): Promise<void> {
    await this.stopNative();
  }

  /**
   * Foreground again. Also covers coming back from the app settings after granting permission:
   * if the first start stopped at the permission step, the full start is run now (without
   * prompting again, since `check()` is used first).
   */
  async resume(): Promise<void> {
    if (!this.native || !this.emit || this.waitingForProvider) return;
    const permission = await this.permissions.check();
    if (permission !== 'granted') return this.fail('E_PERMISSION', MESSAGES[permission]);
    if (this.subscriptions.length === 0) return this.start(this.emit);
    await this.startNative();
  }

  private async startNative(): Promise<void> {
    if (!this.native || this.running) return;
    this.running = true;
    this.gotData = false;
    this.emit?.({ t: 'connection', state: { kind: 'detecting' } });
    try {
      await this.native.start({ minTimeMs: 1000, nmea: true, nmeaBatchMs: 200 });
    } catch (error) {
      this.running = false;
      const code = (error as { code?: string }).code;
      if (code === 'E_PERMISSION') return this.fail('E_PERMISSION', MESSAGES.denied);
      return this.fail('E_IO', error instanceof Error ? error.message : String(error));
    }
  }

  private async stopNative(): Promise<void> {
    if (!this.native || !this.running) return;
    this.running = false;
    await this.native.stop();
  }

  private fail(code: 'E_PERMISSION' | 'E_PROVIDER_DISABLED' | 'E_NO_GNSS_HW' | 'E_IO', message: string): void {
    this.emit?.({ t: 'connection', state: { kind: 'error', code, message } });
  }

  private receiving(): void {
    if (this.gotData) return;
    this.gotData = true;
    this.emit?.({ t: 'connection', state: { kind: 'receiving' } });
  }

  private subscribe(native: AndroidGnssModule): void {
    const emit = (e: GnssEvent) => this.emit?.(e);
    this.subscriptions = [
      native.addListener('onLocation', (l) => {
        this.counts.location += 1;
        if (l.altMsl !== undefined) this.hasMslFromLocation = true;
        emit({ t: 'fix', origin: 'android', fix: fixFromLocation(l) });
        this.receiving();
      }),
      native.addListener('onGnssStatus', ({ sats, atMs }) => {
        this.counts.status += 1;
        const observations = satellitesFromStatus(sats, atMs);
        emit({ t: 'satellites', origin: 'android', scope: 'all', sats: observations });
        const used = observations.filter((s) => s.used).length;
        // Android reports no explicit "fix lost"; no satellites used means no fix.
        emit({ t: 'fix', origin: 'android', fix: used === 0 ? { fixType: 'none', numSvUsed: 0 } : { numSvUsed: used } });
        this.observe(observations, used);
        this.receiving();
      }),
      native.addListener('onFirstFix', ({ ttffMs }) => emit({ t: 'ttff', ms: ttffMs })),
      native.addListener('onNmea', ({ lines }) => {
        this.observed.nmea = true;
        for (const { line } of lines) {
          for (const e of this.nmea.pushLine(line, this.now())) {
            const kept = this.filterNmea(e);
            if (kept) emit(kept);
          }
        }
      }),
      native.addListener('onProviderChanged', (state) => void this.onProviderChanged(state.locationEnabled && state.gpsProviderEnabled)),
    ];
  }

  /** The phone's NMEA only contributes DOP, MSL altitude (when Location lacks it) and TXT info. */
  private filterNmea(e: GnssEvent): GnssEvent | undefined {
    if (e.t === 'dop' || e.t === 'info') return e;
    if (e.t === 'fix' && e.fix.altMslM !== undefined && !this.hasMslFromLocation) {
      return { t: 'fix', origin: 'nmea', fix: { altMslM: e.fix.altMslM } };
    }
    return undefined;
  }

  private async onProviderChanged(enabled: boolean): Promise<void> {
    if (!enabled) {
      this.waitingForProvider = true;
      await this.stopNative();
      this.fail('E_PROVIDER_DISABLED', MESSAGES.locationOff);
    } else if (this.waitingForProvider) {
      this.waitingForProvider = false;
      await this.startNative();
    }
  }

  private observe(observations: SatObservation[], used: number): void {
    for (const o of observations) {
      this.observed.constellations.add(o.constellation);
      for (const s of o.signals ?? []) this.observed.bands.add(s.code);
    }
    this.observed.maxSvUsed = Math.max(this.observed.maxSvUsed, used);
    const observed = this.observedInfo();
    const report = JSON.stringify(observed);
    // Counters change every update; send them with observation changes and every 10 updates.
    if (report !== this.lastObservedReport || this.counts.status % 10 === 0) {
      this.lastObservedReport = report;
      this.emit?.({
        t: 'android',
        patch: { observed, locationUpdates: this.counts.location, statusUpdates: this.counts.status },
      });
    }
  }

  private observedInfo(): AndroidDeviceInfo['observed'] {
    const bands = [...this.observed.bands].sort();
    return {
      constellations: [...this.observed.constellations],
      bands,
      dualFrequency: bands.some(isSecondFrequency),
      nmeaOutput: this.observed.nmea,
      maxSvUsed: this.observed.maxSvUsed,
    };
  }
}
