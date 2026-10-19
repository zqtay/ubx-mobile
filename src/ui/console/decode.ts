import type { GnssEvent } from '@/domain/events';
import { interpretUbx } from '@/protocols/ubx/interpreter';

const hex2 = (b: number) => b.toString(16).toUpperCase().padStart(2, '0');

/** Hex dump, 16 bytes per line with offsets (Console UBX detail). */
export function hexDump(bytes: Uint8Array): string {
  const lines: string[] = [];
  for (let o = 0; o < bytes.length; o += 16) {
    const row = Array.from(bytes.subarray(o, o + 16), hex2).join(' ');
    lines.push(`${o.toString(16).toUpperCase().padStart(4, '0')}  ${row}`);
  }
  return lines.join('\n');
}

/** Wall-clock time with milliseconds, e.g. `11:39:02.104`. */
export function consoleTime(atMs: number): string {
  const d = new Date(atMs);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

const round = (_key: string, value: unknown) =>
  typeof value === 'number' && !Number.isInteger(value) ? Number(value.toPrecision(10)) : value;

/**
 * Decoded fields of a UBX message, as the app interprets it (the normalised events), or
 * undefined when the app has no decoder for it.
 */
export function decodeUbx(cls: number, id: number, payload: Uint8Array): string | undefined {
  let events: GnssEvent[];
  try {
    events = interpretUbx(cls, id, payload, 0);
  } catch {
    return undefined;
  }
  if (events.length === 0) return undefined;
  return events.map((e) => JSON.stringify(e, round, 2)).join('\n');
}

export interface NmeaParts {
  /** e.g. `GN`; `P` for proprietary sentences. */
  talker: string;
  /** e.g. `RMC`; the manufacturer + type for proprietary sentences (e.g. `UBX`). */
  type: string;
  /** Data fields after the address, without checksum. */
  fields: string[];
  checksum?: string;
}

/** Splits an NMEA sentence for the Console detail. */
export function nmeaParts(sentence: string): NmeaParts | undefined {
  const m = /^[$!]([^,*]+)((?:,[^*]*)?)(?:\*([0-9A-Fa-f]{2}))?\s*$/.exec(sentence);
  if (!m) return undefined;
  const address = m[1];
  const proprietary = address.startsWith('P');
  return {
    talker: proprietary ? 'P' : address.slice(0, 2),
    type: proprietary ? address.slice(1) : address.slice(2),
    fields: m[2] ? m[2].slice(1).split(',') : [],
    checksum: m[3]?.toUpperCase(),
  };
}

const hexByte = (b: number) => `0x${b.toString(16).toUpperCase().padStart(2, '0')}`;

/** `0x01 0x07` style class/ID for the detail header. */
export function ubxClassId(cls: number, id: number): string {
  return `${hexByte(cls)} ${hexByte(id)}`;
}

/** Local date and time with milliseconds, e.g. `2026-10-19 11:39:02.104`. */
export function consoleDateTime(atMs: number): string {
  const d = new Date(atMs);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${consoleTime(atMs)}`;
}

/** Index of the UTC time field (hhmmss.ss) in common NMEA sentences. */
const NMEA_TIME_FIELD: Record<string, number> = {
  GGA: 0,
  RMC: 0,
  GNS: 0,
  ZDA: 0,
  GST: 0,
  GBS: 0,
  GLL: 4,
};

/** UTC time carried by an NMEA sentence, e.g. `11:39:02.00 UTC`, if it has one. */
export function nmeaTime(parts: NmeaParts): string | undefined {
  const index = NMEA_TIME_FIELD[parts.type];
  const field = index === undefined ? undefined : parts.fields[index];
  const m = field ? /^(\d{2})(\d{2})(\d{2}(?:\.\d+)?)$/.exec(field) : null;
  return m ? `${m[1]}:${m[2]}:${m[3]} UTC` : undefined;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * GPS time of week of a UBX NAV message (iTOW, first 4 payload bytes), e.g.
 * `Mon 11:39:20.000 GPS (iTOW 128360000 ms)`; undefined for other classes.
 */
export function ubxItow(cls: number, payload: Uint8Array): string | undefined {
  if (cls !== 0x01 || payload.length < 4) return undefined;
  const itow = new DataView(payload.buffer, payload.byteOffset, 4).getUint32(0, true);
  if (itow >= 7 * 86_400_000) return undefined;
  const day = Math.floor(itow / 86_400_000);
  const ms = itow % 86_400_000;
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  const time = `${p(Math.floor(ms / 3_600_000))}:${p(Math.floor(ms / 60_000) % 60)}:${p(Math.floor(ms / 1000) % 60)}.${p(ms % 1000, 3)}`;
  return `${WEEKDAYS[day]} ${time} GPS (iTOW ${itow} ms)`;
}
