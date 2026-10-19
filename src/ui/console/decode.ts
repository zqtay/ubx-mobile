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
