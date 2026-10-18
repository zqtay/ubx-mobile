import type { FixOrigin, GnssEvent } from '@/domain/events';
import { fromNmea, keyOf, talkerToConstellation } from '@/domain/satKey';
import { nmeaSignal } from '@/domain/signals';
import type {
  CarrierSolution,
  Fix,
  FixType,
  InfoLevel,
  NmeaVersion,
  SatObservation,
} from '@/domain/types';

import { parseSentence, utcEpochMs, type NmeaDate, type NmeaTime } from './parser';
import { decodeSentence, type Gga, type Gsa, type Gsv, type NmeaSentence } from './sentences';

const KNOTS_TO_MPS = 0.514444;

interface GsvGroup {
  numMsg: number;
  nextMsg: number;
  sats: SatObservation[];
}

const VERSION_RANK: Record<NmeaVersion, number> = { unknown: 0, '2.x': 1, '2.3+': 2, '4.10+': 3 };

/**
 * Turns NMEA sentences into normalised events (technical spec §6.2).
 *
 * - GGA/RMC/GNS/VTG/GLL produce partial fix updates immediately.
 * - GSV groups (per talker and 4.10+ signal ID) are emitted as one satellite set once complete.
 * - Consecutive GSA sentences form one used-in-fix set; it is emitted (with DOP) as soon as a
 *   non-GSA sentence follows, which works for any sentence order within an epoch.
 */
export class NmeaInterpreter {
  private gsv = new Map<string, GsvGroup>();
  private gsaBatch: Gsa[] = [];
  private lastDate?: NmeaDate;
  private navMode?: number;
  private quality?: number;
  private rmcValid?: boolean;
  private talkers = new Set<string>();
  private version: NmeaVersion = 'unknown';

  constructor(private readonly origin: FixOrigin = 'nmea') {}

  /** Parses and interprets one sentence line; malformed lines yield no events. */
  pushLine(line: string, rxMs: number): GnssEvent[] {
    const raw = parseSentence(line);
    if (!raw) return [];
    const sentence = decodeSentence(raw);
    if (!sentence) return [];
    return this.push(sentence, rxMs);
  }

  push(s: NmeaSentence, rxMs: number): GnssEvent[] {
    const events: GnssEvent[] = [];
    if (s.type !== 'GSA' && this.gsaBatch.length > 0) events.push(...this.flushGsa());
    this.noteTalker(s.talker, events);

    switch (s.type) {
      case 'GGA':
        this.quality = s.quality;
        events.push(this.fixEvent(this.fromGga(s)));
        break;
      case 'RMC': {
        if (s.date) this.lastDate = s.date;
        this.rmcValid = s.status === 'A';
        if (s.navStatus) this.noteVersion('4.10+', events);
        else if (s.mode) this.noteVersion('2.3+', events);
        else this.noteVersion('2.x', events);
        const patch: Partial<Fix> = {
          lat: s.lat,
          lon: s.lon,
          speedMps: s.speedKnots !== undefined ? s.speedKnots * KNOTS_TO_MPS : undefined,
          courseDeg: s.courseDeg,
          utc: this.utc(s.time, s.date),
        };
        if (s.status === 'V') patch.fixType = 'none';
        events.push(this.fixEvent(patch));
        break;
      }
      case 'GNS':
        events.push(
          this.fixEvent({
            lat: s.lat,
            lon: s.lon,
            altMslM: s.altMsl,
            altEllipsoidM:
              s.altMsl !== undefined && s.geoidSep !== undefined
                ? s.altMsl + s.geoidSep
                : undefined,
            numSvUsed: s.numSv,
            utc: this.utc(s.time),
          }),
        );
        if (s.navStatus) this.noteVersion('4.10+', events);
        break;
      case 'VTG': {
        const speedMps =
          s.speedKmh !== undefined
            ? s.speedKmh / 3.6
            : s.speedKnots !== undefined
              ? s.speedKnots * KNOTS_TO_MPS
              : undefined;
        events.push(this.fixEvent({ speedMps, courseDeg: s.courseTrueDeg }));
        if (s.mode) this.noteVersion('2.3+', events);
        break;
      }
      case 'GLL':
        if (s.status === 'A')
          events.push(this.fixEvent({ lat: s.lat, lon: s.lon, utc: this.utc(s.time) }));
        break;
      case 'ZDA':
        if (s.date) this.lastDate = s.date;
        if (s.time && s.date) events.push(this.fixEvent({ utc: this.utc(s.time, s.date) }));
        break;
      case 'GSA':
        this.gsaBatch.push(s);
        if (s.systemId !== undefined) this.noteVersion('4.10+', events);
        break;
      case 'GSV':
        this.onGsv(s, rxMs, events);
        break;
      case 'TXT':
        events.push({
          t: 'info',
          level: txtLevel(s.textId),
          text: s.text,
          origin: `NMEA ${s.talker}TXT`,
        });
        break;
    }
    return events;
  }

  /** Emits anything still buffered (e.g. a trailing GSA batch at end of a replay). */
  flush(): GnssEvent[] {
    return this.gsaBatch.length > 0 ? this.flushGsa() : [];
  }

  private fromGga(s: Gga): Partial<Fix> {
    return {
      lat: s.lat,
      lon: s.lon,
      altMslM: s.altMsl,
      altEllipsoidM:
        s.altMsl !== undefined && s.geoidSep !== undefined ? s.altMsl + s.geoidSep : undefined,
      numSvUsed: s.numSv,
      utc: this.utc(s.time),
      differential: s.quality !== undefined ? [2, 4, 5].includes(s.quality) : undefined,
      carrierSolution: carrierFromQuality(s.quality),
    };
  }

  /** Adds the derived fix type to a patch and drops undefined fields. */
  private fixEvent(patch: Partial<Fix>): GnssEvent {
    const fix: Partial<Fix> = {};
    for (const [k, v] of Object.entries(patch)) {
      if (v !== undefined) (fix as Record<string, unknown>)[k] = v;
    }
    if (fix.fixType === undefined) {
      const derived = this.deriveFixType();
      if (derived) fix.fixType = derived;
    }
    return { t: 'fix', fix, origin: this.origin };
  }

  private deriveFixType(): FixType | undefined {
    if (this.quality === 0 || this.navMode === 1 || this.rmcValid === false) return 'none';
    if (this.quality === 6) return 'dead-reckoning';
    if (this.navMode === 2) return '2d';
    if (this.navMode === 3) return '3d';
    if (this.quality !== undefined && this.quality > 0) return '3d';
    if (this.rmcValid) return '3d';
    return undefined;
  }

  private utc(time: NmeaTime | undefined, date?: NmeaDate): Fix['utc'] | undefined {
    if (!time) return undefined;
    const d = date ?? this.lastDate;
    if (d) return { epochMs: utcEpochMs(d, time), dateValid: true, timeValid: true };
    const now = new Date();
    const today = {
      year: now.getUTCFullYear(),
      month: now.getUTCMonth() + 1,
      day: now.getUTCDate(),
    };
    return { epochMs: utcEpochMs(today, time), dateValid: false, timeValid: true };
  }

  private flushGsa(): GnssEvent[] {
    const batch = this.gsaBatch;
    this.gsaBatch = [];
    const keys: string[] = [];
    for (const g of batch) {
      for (const sv of g.svs) {
        const id = fromNmea(g.talker, sv, g.systemId);
        if (id) keys.push(keyOf(id));
      }
    }
    const last = batch[batch.length - 1];
    this.navMode = last.navMode;
    const events: GnssEvent[] = [{ t: 'used', scope: 'all', keys }];
    if (last.pdop !== undefined || last.hdop !== undefined || last.vdop !== undefined) {
      events.push({
        t: 'dop',
        dop: { p: last.pdop, h: last.hdop, v: last.vdop },
        origin: this.origin === 'android' ? 'android-nmea' : 'nmea',
      });
    }
    const fixType = this.deriveFixType();
    if (fixType) events.push({ t: 'fix', fix: { fixType }, origin: this.origin });
    return events;
  }

  private onGsv(s: Gsv, rxMs: number, events: GnssEvent[]): void {
    if (s.signalId !== undefined) this.noteVersion('4.10+', events);
    const groupKey = `${s.talker}:${s.signalId ?? 0}`;
    let group = this.gsv.get(groupKey);
    if (s.msgNum === 1) {
      group = { numMsg: s.numMsg, nextMsg: 1, sats: [] };
      this.gsv.set(groupKey, group);
    } else if (!group || group.nextMsg !== s.msgNum || group.numMsg !== s.numMsg) {
      // Out-of-sequence part (e.g. a sentence was lost): drop the incomplete group.
      this.gsv.delete(groupKey);
      return;
    }
    const constellationHint = talkerToConstellation(s.talker);
    for (const sat of s.sats) {
      const id = fromNmea(s.talker, sat.svid);
      if (!id) continue;
      const cn0 = sat.cn0 ?? 0;
      const signal =
        s.signalId !== undefined
          ? nmeaSignal(constellationHint ?? id.constellation, s.signalId)
          : undefined;
      group.sats.push({
        key: keyOf(id),
        constellation: id.constellation,
        svid: id.svid,
        glonassFcn: id.glonassFcn,
        cn0,
        elevation: sat.elevation,
        azimuth: sat.elevation === undefined ? undefined : sat.azimuth,
        signals: signal ? [{ ...signal, cn0, lastSeenMs: rxMs }] : undefined,
      });
    }
    group.nextMsg = s.msgNum + 1;
    if (s.msgNum < s.numMsg) return;
    this.gsv.delete(groupKey);
    events.push({ t: 'satellites', origin: 'nmea', scope: `nmea:${groupKey}`, sats: group.sats });
  }

  private noteTalker(talker: string, events: GnssEvent[]): void {
    if (talker === 'P' || this.talkers.has(talker)) return;
    this.talkers.add(talker);
    events.push({
      t: 'receiver',
      patch: { nmeaDetected: true, talkers: [...this.talkers].sort() },
    });
  }

  private noteVersion(v: NmeaVersion, events: GnssEvent[]): void {
    if (VERSION_RANK[v] <= VERSION_RANK[this.version]) return;
    this.version = v;
    events.push({ t: 'receiver', patch: { nmeaVersion: v } });
  }
}

function carrierFromQuality(quality: number | undefined): CarrierSolution | undefined {
  if (quality === 4) return 'fixed';
  if (quality === 5) return 'float';
  if (quality === undefined) return undefined;
  return 'none';
}

function txtLevel(textId: number | undefined): InfoLevel {
  switch (textId) {
    case 0:
      return 'error';
    case 1:
      return 'warning';
    case 2:
      return 'notice';
    default:
      return 'debug';
  }
}
