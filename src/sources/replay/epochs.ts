import { StreamDecoder, type DecodedFrame } from '@/protocols/stream/StreamDecoder';

/** Byte range of one navigation epoch in a recorded log. */
export interface EpochRange {
  start: number;
  end: number;
}

const TIME_SENTENCES = new Set(['GGA', 'RMC', 'GNS', 'GLL', 'ZDA']);

/** UBX NAV messages whose payload starts with iTOW. */
function ubxTimeKey(frame: Extract<DecodedFrame, { kind: 'ubx' }>): number | undefined {
  if (frame.cls !== 0x01 || frame.payload.length < 4) return undefined;
  const p = frame.payload;
  return (p[0] | (p[1] << 8) | (p[2] << 16) | (p[3] << 24)) >>> 0;
}

function nmeaTimeKey(frame: Extract<DecodedFrame, { kind: 'nmea' }>): string | undefined {
  const fields = frame.text.split(',');
  const type = fields[0].slice(3);
  if (!TIME_SENTENCES.has(type)) return undefined;
  const time = type === 'GLL' ? fields[5] : fields[1];
  return time ? time.split('*')[0] : undefined;
}

/**
 * Splits a recorded log into epochs (technical spec §7.1, REQ-SRC-05). Logs carry no reception
 * timestamps, so epochs are delimited by the receiver's own time: UBX iTOW when the log has
 * UBX NAV messages, otherwise NMEA UTC time (the two clocks differ by leap seconds, so they are
 * never mixed). Frames before the first time-bearing frame belong to the first epoch.
 */
export function splitEpochs(bytes: Uint8Array): EpochRange[] {
  const frames = new StreamDecoder().push(bytes, 0);
  const useUbx = frames.some((f) => f.kind === 'ubx' && ubxTimeKey(f) !== undefined);
  const ranges: EpochRange[] = [];
  let start = 0;
  let current: number | string | undefined;
  let prevEnd = 0;
  for (const frame of frames) {
    const key =
      useUbx && frame.kind === 'ubx'
        ? ubxTimeKey(frame)
        : !useUbx && frame.kind === 'nmea'
          ? nmeaTimeKey(frame)
          : undefined;
    if (key !== undefined && current !== undefined && key !== current) {
      ranges.push({ start, end: prevEnd });
      start = prevEnd;
    }
    if (key !== undefined) current = key;
    prevEnd = frame.endOffset;
  }
  if (bytes.length > start) ranges.push({ start, end: bytes.length });
  return ranges;
}
