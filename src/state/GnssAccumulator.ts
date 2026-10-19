import { constellationOrder } from '@/domain/constellations';
import type { DopOrigin, FixOrigin, GnssEvent } from '@/domain/events';
import type {
  AndroidDeviceInfo,
  ConnectionState,
  Dop,
  Fix,
  FixType,
  GnssSnapshot,
  ReceiverInfo,
  SatKey,
  SatObservation,
  SatOrigin,
  Satellite,
  SessionInfo,
  SignalObs,
  SourceKind,
  StreamStats,
  UsbDeviceInfo,
} from '@/domain/types';
import { emptyStreamStats } from '@/protocols/stream/StreamDecoder';

export interface AccumulatorOptions {
  /** Satellites and signals not reported for this long are removed (REQ-SAT-12). */
  satelliteTimeoutMs: number;
  /** A lower-ranked origin may overwrite data only if the higher-ranked one is older than this. */
  precedenceWindowMs?: number;
  /** Monotonic clock; injectable for tests. */
  now?: () => number;
}

/** Precedence ranks (technical spec §7.2, REQ-SER-10): UBX beats NMEA; Android is authoritative. */
const SAT_RANK: Record<SatOrigin, number> = {
  android: 3,
  'ubx-nav-sat': 3,
  'ubx-nav-svinfo': 2,
  nmea: 1,
};
const FIX_RANK: Record<FixOrigin, number> = { android: 3, ubx: 3, nmea: 1 };
const DOP_RANK: Record<DopOrigin, number> = { ubx: 3, 'android-nmea': 1, nmea: 1 };
const MAX_INFO_MESSAGES = 50;

const POSITION_FIXES: ReadonlySet<FixType> = new Set(['2d', '3d', 'gnss-dr', 'dead-reckoning']);

/**
 * Holds the current GNSS state outside React and applies events in place (technical spec §7.2).
 * A timer snapshots it into the store at the UI refresh rate; unchanged satellites keep their
 * object identity so memoised list rows don't re-render.
 */
export class GnssAccumulator {
  private readonly now: () => number;
  private readonly window: number;
  private timeoutMs: number;

  private source: SourceKind | null = null;
  private connection: ConnectionState = { kind: 'idle' };
  private sats = new Map<SatKey, Satellite>();
  private fix?: Fix;
  private fixRank = 0;
  private fixMs = 0;
  private dop?: Dop;
  private dopRank = 0;
  private dopMs = 0;
  private session?: SessionInfo;
  private receiver: ReceiverInfo = {};
  private android?: AndroidDeviceInfo;
  private usb?: UsbDeviceInfo;
  private stats: StreamStats = emptyStreamStats();
  /** Used set from the latest NMEA GSA batch, applied to satellites first seen afterwards. */
  private nmeaUsed = new Set<SatKey>();

  private dirty = true;
  private cached?: GnssSnapshot;

  constructor(options: AccumulatorOptions) {
    this.now = options.now ?? (() => Date.now());
    this.window = options.precedenceWindowMs ?? 3000;
    this.timeoutMs = options.satelliteTimeoutMs;
  }

  /** Clears all data and starts a new session for `source`. */
  start(source: SourceKind): void {
    this.source = source;
    this.connection = { kind: 'connecting' };
    this.sats = new Map();
    this.fix = undefined;
    this.fixRank = 0;
    this.dop = undefined;
    this.dopRank = 0;
    this.session = { startedAtMs: this.now() };
    this.receiver = {};
    this.android = undefined;
    this.usb = undefined;
    this.stats = emptyStreamStats();
    this.nmeaUsed = new Set();
    this.dirty = true;
  }

  /** Clears satellites and TTFF after a receiver restart (REQ-CFG-14), keeping identity info. */
  restartSession(): void {
    this.sats = new Map();
    this.fix = undefined;
    this.fixRank = 0;
    this.session = { startedAtMs: this.now() };
    this.dirty = true;
  }

  setSatelliteTimeout(ms: number): void {
    this.timeoutMs = ms;
  }

  get isDirty(): boolean {
    return this.dirty;
  }

  applyAll(events: readonly GnssEvent[]): void {
    for (const e of events) this.apply(e);
  }

  apply(e: GnssEvent): void {
    const now = this.now();
    switch (e.t) {
      case 'satellites':
        this.applySatellites(e.origin, e.sats, now);
        break;
      case 'signals':
        this.applySignals(e.signals, now);
        break;
      case 'used':
        this.applyUsed(e.scope, e.keys);
        break;
      case 'fix':
        this.applyFix(e.fix, FIX_RANK[e.origin], now);
        break;
      case 'dop':
        if (DOP_RANK[e.origin] < this.dopRank && now - this.dopMs < this.window) return;
        this.dop = { ...this.dop, ...definedOnly(e.dop) };
        this.dopRank = DOP_RANK[e.origin];
        this.dopMs = now;
        break;
      case 'ttff':
        if (this.session) this.session = { ...this.session, ttffMs: e.ms, ttffSource: 'receiver' };
        break;
      case 'receiver':
        this.receiver = { ...this.receiver, ...definedOnly(e.patch) };
        break;
      case 'usb':
        this.usb = { ...(this.usb as UsbDeviceInfo), ...definedOnly(e.patch) };
        break;
      case 'android':
        this.android = { ...(this.android as AndroidDeviceInfo), ...definedOnly(e.patch) };
        break;
      case 'info':
        this.receiver = {
          ...this.receiver,
          infoMessages: [
            ...(this.receiver.infoMessages ?? []),
            { atMs: now, level: e.level, text: e.text, origin: e.origin },
          ].slice(-MAX_INFO_MESSAGES),
        };
        break;
      case 'connection':
        this.connection = e.state;
        break;
      case 'session-restart':
        this.restartSession();
        return;
      case 'stats':
        this.stats = e.stats;
        break;
    }
    this.dirty = true;
  }

  /** Removes satellites and signals older than the timeout. Returns true if anything changed. */
  prune(): boolean {
    const now = this.now();
    let changed = false;
    for (const [key, sat] of this.sats) {
      if (now - sat.lastSeenMs > this.timeoutMs) {
        this.sats.delete(key);
        changed = true;
        continue;
      }
      const fresh = sat.signals.filter(
        (s) => s.lastSeenMs === undefined || now - s.lastSeenMs <= this.timeoutMs,
      );
      if (fresh.length !== sat.signals.length) {
        const cn0 = sat.origin === 'nmea' && fresh.length > 0 ? maxCn0(fresh) : sat.cn0;
        this.sats.set(key, { ...sat, signals: fresh, cn0 });
        changed = true;
      }
    }
    if (changed) this.dirty = true;
    return changed;
  }

  snapshot(): GnssSnapshot {
    if (!this.dirty && this.cached) return this.cached;
    const satellites = [...this.sats.values()].sort(compareSatellites);
    this.cached = {
      source: this.source,
      connection: this.connection,
      fix: this.fix,
      dop: this.dop,
      session: this.session,
      satellites,
      device: {
        receiver: this.receiver,
        ...(this.android ? { android: this.android } : {}),
        ...(this.usb ? { usb: this.usb } : {}),
      },
      stats: this.stats,
      stale: this.connection.kind === 'disconnected' || this.connection.kind === 'error',
    };
    this.dirty = false;
    return this.cached;
  }

  private applySatellites(origin: SatOrigin, observations: SatObservation[], now: number): void {
    const rank = SAT_RANK[origin];
    for (const obs of observations) {
      const existing = this.sats.get(obs.key);
      if (
        existing &&
        SAT_RANK[existing.origin] > rank &&
        now - existing.originUpdatedMs < this.window
      ) {
        continue;
      }
      const { signals: obsSignals, ...fields } = obs;
      const keepSignals = existing && (existing.origin === origin || !obsSignals);
      let signals = keepSignals ? existing.signals : [];
      if (obsSignals) signals = mergeSignals(signals, obsSignals);
      const cn0 = obsSignals && obsSignals.length > 0 ? maxCn0(signals) : obs.cn0;
      let used = obs.used;
      if (used === undefined && origin === 'nmea') {
        used = existing?.origin === 'nmea' ? existing.used : this.nmeaUsed.has(obs.key);
      }
      this.sats.set(obs.key, {
        ...fields,
        cn0,
        used,
        signals,
        origin,
        originUpdatedMs: now,
        lastSeenMs: now,
      });
    }
  }

  private applySignals(
    signals: Extract<GnssEvent, { t: 'signals' }>['signals'],
    now: number,
  ): void {
    const bySat = new Map<SatKey, typeof signals>();
    for (const s of signals) {
      const list = bySat.get(s.key);
      if (list) list.push(s);
      else bySat.set(s.key, [s]);
    }
    for (const [key, list] of bySat) {
      const first = list[0];
      const existing = this.sats.get(key);
      const sigs: SignalObs[] = list.map(
        ({ key: _k, constellation: _c, svid: _s, glonassFcn: _g, ...sig }) => ({
          ...sig,
          lastSeenMs: sig.lastSeenMs ?? now,
        }),
      );
      if (existing) {
        this.sats.set(key, {
          ...existing,
          signals: sigs,
          cn0: existing.cn0 ?? maxCn0(sigs),
          lastSeenMs: now,
        });
      } else {
        this.sats.set(key, {
          key,
          constellation: first.constellation,
          svid: first.svid,
          glonassFcn: first.glonassFcn,
          cn0: maxCn0(sigs),
          used: sigs.some((s) => s.used),
          signals: sigs,
          origin: 'ubx-nav-sat',
          originUpdatedMs: now,
          lastSeenMs: now,
        });
      }
    }
  }

  private applyUsed(scope: 'all' | string, keys: SatKey[]): void {
    const set = new Set(keys);
    this.nmeaUsed = set;
    for (const [key, sat] of this.sats) {
      if (sat.origin !== 'nmea') continue;
      if (scope !== 'all' && sat.constellation !== scope) continue;
      const used = set.has(key);
      if (sat.used !== used) this.sats.set(key, { ...sat, used });
    }
  }

  private applyFix(patch: Partial<Fix>, rank: number, now: number): void {
    if (rank < this.fixRank && now - this.fixMs < this.window) return;
    this.fix = { fixType: 'none', ...this.fix, ...definedOnly(patch), receivedAtMs: now };
    this.fixRank = rank;
    this.fixMs = now;
    if (this.session && this.session.ttffMs === undefined && POSITION_FIXES.has(this.fix.fixType)) {
      this.session = {
        ...this.session,
        ttffMs: now - this.session.startedAtMs,
        ttffSource: 'measured',
      };
    }
  }
}

function definedOnly<T extends object>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const key of Object.keys(obj) as (keyof T)[]) {
    if (obj[key] !== undefined) out[key] = obj[key];
  }
  return out;
}

function mergeSignals(current: SignalObs[], incoming: SignalObs[]): SignalObs[] {
  const byCode = new Map(current.map((s) => [s.code, s]));
  for (const s of incoming) byCode.set(s.code, s);
  return [...byCode.values()];
}

function maxCn0(signals: SignalObs[]): number {
  let max = 0;
  for (const s of signals) if (s.cn0 !== undefined && s.cn0 > max) max = s.cn0;
  return max;
}

export function compareSatellites(a: Satellite, b: Satellite): number {
  return (
    constellationOrder(a.constellation) - constellationOrder(b.constellation) ||
    a.svid - b.svid ||
    (a.glonassFcn ?? 0) - (b.glonassFcn ?? 0)
  );
}
