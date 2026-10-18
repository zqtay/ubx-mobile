import type { StreamStats } from '@/domain/types';

import { crc24q } from '../rtcm/crc24q';
import { ubxChecksum } from '../ubx/checksum';

export type DecodedFrame =
  | { kind: 'nmea'; text: string; rxMs: number }
  | { kind: 'ubx'; cls: number; id: number; payload: Uint8Array; rxMs: number }
  | { kind: 'rtcm3'; messageType: number; length: number; rxMs: number };

/** Longest NMEA sentence accepted, including `$` and CR/LF (u-blox PUBX can exceed 82). */
export const MAX_NMEA_LENGTH = 200;
/** Larger UBX payloads are treated as corrupt length fields. */
export const MAX_UBX_PAYLOAD = 8192;

const DOLLAR = 0x24;
const BANG = 0x21;
const CR = 0x0d;
const LF = 0x0a;
const UBX_SYNC1 = 0xb5;
const UBX_SYNC2 = 0x62;
const RTCM_PREAMBLE = 0xd3;

export function emptyStreamStats(): StreamStats {
  return {
    bytes: 0,
    nmeaFrames: 0,
    ubxFrames: 0,
    rtcmFrames: 0,
    nmeaChecksumErrors: 0,
    nmeaNoChecksum: 0,
    ubxChecksumErrors: 0,
    rtcmCrcErrors: 0,
    junkBytes: 0,
  };
}

type Step =
  | { status: 'frame'; frame: DecodedFrame; consumed: number }
  | { status: 'need-more' }
  | { status: 'invalid' };

/**
 * Splits a byte stream of any chunking into NMEA, UBX and RTCM 3 frames (technical spec §6.1).
 * Frames failing validation are dropped and the decoder resynchronises from the byte after the
 * lead byte, so a corrupt length field cannot swallow valid frames that follow.
 */
export class StreamDecoder {
  private buf = new Uint8Array(64 * 1024);
  private start = 0;
  private end = 0;
  readonly stats: StreamStats = emptyStreamStats();

  /** Feeds a chunk and returns every complete frame it finishes. */
  push(chunk: Uint8Array, rxMs: number): DecodedFrame[] {
    this.append(chunk);
    this.stats.bytes += chunk.length;
    const frames: DecodedFrame[] = [];
    while (this.start < this.end) {
      const lead = this.buf[this.start];
      let step: Step;
      if (lead === DOLLAR || lead === BANG) step = this.tryNmea(rxMs);
      else if (lead === UBX_SYNC1) step = this.tryUbx(rxMs);
      else if (lead === RTCM_PREAMBLE) step = this.tryRtcm(rxMs);
      else step = { status: 'invalid' };

      if (step.status === 'need-more') break;
      if (step.status === 'frame') {
        frames.push(step.frame);
        this.start += step.consumed;
        this.stats.lastFrameMs = rxMs;
      } else {
        this.start += 1;
        this.stats.junkBytes += 1;
      }
    }
    return frames;
  }

  /** Bytes held while waiting for the rest of a frame. */
  get pending(): number {
    return this.end - this.start;
  }

  reset(): void {
    this.start = 0;
    this.end = 0;
  }

  private append(chunk: Uint8Array): void {
    if (this.start === this.end) {
      this.start = 0;
      this.end = 0;
    }
    if (this.end + chunk.length > this.buf.length) {
      // Compact the unconsumed bytes to the front, growing the buffer only if they still don't fit.
      const live = this.end - this.start;
      const needed = live + chunk.length;
      if (needed > this.buf.length) {
        const next = new Uint8Array(Math.max(needed, this.buf.length * 2));
        next.set(this.buf.subarray(this.start, this.end));
        this.buf = next;
      } else {
        this.buf.copyWithin(0, this.start, this.end);
      }
      this.start = 0;
      this.end = live;
    }
    this.buf.set(chunk, this.end);
    this.end += chunk.length;
  }

  private tryNmea(rxMs: number): Step {
    const { buf, start, end } = this;
    const limit = Math.min(end, start + MAX_NMEA_LENGTH);
    let lf = -1;
    for (let i = start + 1; i < limit; i++) {
      const c = buf[i];
      if (c === LF) {
        lf = i;
        break;
      }
      // Only printable ASCII (and CR right before LF) may appear inside a sentence.
      if (c === CR) continue;
      if (c < 0x20 || c > 0x7e) return { status: 'invalid' };
      if (c === DOLLAR || c === BANG) return { status: 'invalid' };
    }
    if (lf < 0) {
      return end - start >= MAX_NMEA_LENGTH ? { status: 'invalid' } : { status: 'need-more' };
    }

    let stop = lf;
    while (stop > start && buf[stop - 1] === CR) stop--;
    let text = '';
    for (let i = start; i < stop; i++) text += String.fromCharCode(buf[i]);
    if (text.indexOf('\r') >= 0) return { status: 'invalid' };

    const star = text.lastIndexOf('*');
    if (star >= 0 && star === text.length - 3) {
      const expected = parseInt(text.slice(star + 1), 16);
      let sum = 0;
      for (let i = 1; i < star; i++) sum ^= text.charCodeAt(i);
      if (Number.isNaN(expected) || expected !== sum) {
        this.stats.nmeaChecksumErrors += 1;
        return { status: 'invalid' };
      }
    } else if (star >= 0) {
      return { status: 'invalid' };
    } else {
      this.stats.nmeaNoChecksum += 1;
    }
    if (text.length < 6) return { status: 'invalid' };
    this.stats.nmeaFrames += 1;
    return { status: 'frame', frame: { kind: 'nmea', text, rxMs }, consumed: lf + 1 - start };
  }

  private tryUbx(rxMs: number): Step {
    const { buf, start, end } = this;
    if (end - start < 2) return { status: 'need-more' };
    if (buf[start + 1] !== UBX_SYNC2) return { status: 'invalid' };
    if (end - start < 6) return { status: 'need-more' };
    const len = buf[start + 4] | (buf[start + 5] << 8);
    if (len > MAX_UBX_PAYLOAD) return { status: 'invalid' };
    const total = 8 + len;
    if (end - start < total) return { status: 'need-more' };
    const ck = ubxChecksum(buf, start + 2, start + 6 + len);
    const ckA = buf[start + 6 + len];
    const ckB = buf[start + 7 + len];
    if ((ck & 0xff) !== ckA || ck >> 8 !== ckB) {
      this.stats.ubxChecksumErrors += 1;
      return { status: 'invalid' };
    }
    this.stats.ubxFrames += 1;
    return {
      status: 'frame',
      frame: {
        kind: 'ubx',
        cls: buf[start + 2],
        id: buf[start + 3],
        payload: buf.slice(start + 6, start + 6 + len),
        rxMs,
      },
      consumed: total,
    };
  }

  private tryRtcm(rxMs: number): Step {
    const { buf, start, end } = this;
    if (end - start < 3) return { status: 'need-more' };
    // The 6 bits after the preamble are reserved (zero).
    if ((buf[start + 1] & 0xfc) !== 0) return { status: 'invalid' };
    const len = ((buf[start + 1] & 0x03) << 8) | buf[start + 2];
    const total = 3 + len + 3;
    if (end - start < total) return { status: 'need-more' };
    const crc = crc24q(buf, start, start + 3 + len);
    const got = (buf[start + 3 + len] << 16) | (buf[start + 4 + len] << 8) | buf[start + 5 + len];
    if (crc !== got || len < 2) {
      this.stats.rtcmCrcErrors += 1;
      return { status: 'invalid' };
    }
    this.stats.rtcmFrames += 1;
    const messageType = (buf[start + 3] << 4) | (buf[start + 4] >> 4);
    return {
      status: 'frame',
      frame: { kind: 'rtcm3', messageType, length: len, rxMs },
      consumed: total,
    };
  }
}
