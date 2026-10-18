import { nmeaChecksum } from './checksum';

/** A framed NMEA sentence split into fields (checksum removed). */
export interface RawSentence {
  /** Two-letter talker ID (`GP`, `GN`, …) or `P` for proprietary sentences. */
  talker: string;
  /** Sentence formatter, e.g. `GGA`; for proprietary sentences the rest of the address (e.g. `UBX`). */
  type: string;
  /** Fields after the address. */
  fields: string[];
  /** Checksum present and valid (false when absent). */
  checksumOk: boolean;
  text: string;
}

/**
 * Splits a sentence like `$GPGGA,...*hh`. Returns undefined when it isn't a well-formed NMEA
 * sentence or the checksum is wrong. Used both for decoder output and for NMEA lines that
 * arrive already framed (Android OnNmeaMessageListener).
 */
export function parseSentence(input: string): RawSentence | undefined {
  const text = input.trim();
  if (text.length < 6 || (text[0] !== '$' && text[0] !== '!')) return undefined;
  let body = text.slice(1);
  let checksumOk = false;
  const star = body.lastIndexOf('*');
  if (star >= 0) {
    const expected = parseInt(body.slice(star + 1), 16);
    body = body.slice(0, star);
    if (Number.isNaN(expected) || expected !== nmeaChecksum(body)) return undefined;
    checksumOk = true;
  }
  const parts = body.split(',');
  const address = parts[0];
  if (address.length < 3) return undefined;
  const proprietary = address[0] === 'P';
  return {
    talker: proprietary ? 'P' : address.slice(0, 2),
    type: proprietary ? address.slice(1) : address.slice(2),
    fields: parts.slice(1),
    checksumOk,
    text,
  };
}

/** Number from a field; undefined when empty or not numeric. */
export function num(field: string | undefined): number | undefined {
  if (field === undefined || field === '') return undefined;
  const n = Number(field);
  return Number.isFinite(n) ? n : undefined;
}

export function int(field: string | undefined, radix = 10): number | undefined {
  if (field === undefined || field === '') return undefined;
  const n = parseInt(field, radix);
  return Number.isNaN(n) ? undefined : n;
}

/** `ddmm.mmmm` / `dddmm.mmmm` + hemisphere → signed decimal degrees. */
export function parseLatLon(
  value: string | undefined,
  hemisphere: string | undefined,
): number | undefined {
  if (!value || !hemisphere) return undefined;
  const dot = value.indexOf('.');
  const degLen = (dot < 0 ? value.length : dot) - 2;
  if (degLen < 1) return undefined;
  const deg = Number(value.slice(0, degLen));
  const min = Number(value.slice(degLen));
  if (!Number.isFinite(deg) || !Number.isFinite(min) || min >= 60) return undefined;
  const result = deg + min / 60;
  return hemisphere === 'S' || hemisphere === 'W' ? -result : result;
}

export interface NmeaTime {
  hours: number;
  minutes: number;
  seconds: number;
  /** Milliseconds since midnight UTC. */
  msOfDay: number;
}

/** `hhmmss.ss` → time of day. */
export function parseTime(value: string | undefined): NmeaTime | undefined {
  if (!value || value.length < 6) return undefined;
  const hours = Number(value.slice(0, 2));
  const minutes = Number(value.slice(2, 4));
  const seconds = Number(value.slice(4));
  if (
    ![hours, minutes, seconds].every(Number.isFinite) ||
    hours > 23 ||
    minutes > 59 ||
    seconds >= 61
  ) {
    return undefined;
  }
  return {
    hours,
    minutes,
    seconds,
    msOfDay: Math.round(((hours * 60 + minutes) * 60 + seconds) * 1000),
  };
}

export interface NmeaDate {
  year: number;
  month: number;
  day: number;
}

/** `ddmmyy` → date (years 80–99 → 19xx, otherwise 20xx). */
export function parseDate(value: string | undefined): NmeaDate | undefined {
  if (!value || value.length !== 6) return undefined;
  const day = Number(value.slice(0, 2));
  const month = Number(value.slice(2, 4));
  const yy = Number(value.slice(4, 6));
  if (![day, month, yy].every(Number.isFinite) || day < 1 || day > 31 || month < 1 || month > 12) {
    return undefined;
  }
  return { year: yy >= 80 ? 1900 + yy : 2000 + yy, month, day };
}

export function utcEpochMs(date: NmeaDate, time: NmeaTime): number {
  return Date.UTC(date.year, date.month - 1, date.day) + time.msOfDay;
}
