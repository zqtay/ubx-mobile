import type { ConsoleEntry, GnssEvent } from '@/domain/events';

import { MessageTracker } from './messageStats';
import { NmeaInterpreter } from './nmea/interpreter';
import { StreamDecoder, type DecodedFrame } from './stream/StreamDecoder';
import { ubxMessageName } from './ubx/ids';
import { interpretUbx } from './ubx/interpreter';

/**
 * Byte stream → frames → normalised events, for transports that deliver raw receiver output
 * (USB serial, replayed logs). Transport-independent (requirements REQ-ARC-02).
 */
export class ProtocolPipeline {
  readonly decoder = new StreamDecoder();
  private readonly nmea = new NmeaInterpreter('nmea');
  private readonly messages = new MessageTracker();
  private ubxSeen = false;

  push(chunk: Uint8Array, rxMs: number): { frames: DecodedFrame[]; events: GnssEvent[] } {
    const before = { ...this.decoder.stats };
    const frames = this.decoder.push(chunk, rxMs);
    this.messages.recordBytes(chunk.length, rxMs);
    const events: GnssEvent[] = [];
    for (const frame of frames) {
      this.messages.record(frame);
      if (frame.kind === 'nmea') {
        events.push(...this.nmea.pushLine(frame.text, frame.rxMs));
      } else if (frame.kind === 'ubx') {
        if (!this.ubxSeen) {
          this.ubxSeen = true;
          events.push({ t: 'receiver', patch: { ubxDetected: true } });
        }
        events.push(...interpretUbx(frame.cls, frame.id, frame.payload, frame.rxMs));
      }
    }
    const entries = consoleEntries(frames, before, this.decoder.stats);
    if (entries.length > 0) events.push({ t: 'console', entries });
    events.push({ t: 'stats', stats: { ...this.decoder.stats, ...this.messages.snapshot(rxMs) } });
    return { frames, events };
  }

  /** Emits events still buffered at the end of a stream. */
  flush(): GnssEvent[] {
    return this.nmea.flush();
  }
}

type ErrorCounters = Pick<
  StreamDecoder['stats'],
  'nmeaChecksumErrors' | 'ubxChecksumErrors' | 'rtcmCrcErrors'
>;

/** Console lines for decoded frames and new checksum errors (functional spec §8). */
export function consoleEntries(
  frames: readonly DecodedFrame[],
  before: ErrorCounters,
  after: ErrorCounters,
): ConsoleEntry[] {
  const entries: ConsoleEntry[] = frames.map((f) => {
    if (f.kind === 'nmea') {
      const text = f.text.trimEnd();
      return { kind: 'nmea', name: text.slice(1).split(/[,*]/)[0], text };
    }
    if (f.kind === 'ubx') {
      const name = ubxMessageName(f.cls, f.id);
      return {
        kind: 'ubx',
        name,
        text: `${name} (${f.payload.length} B)`,
        ubx: { cls: f.cls, id: f.id, payload: f.payload },
      };
    }
    const name = `RTCM3 ${f.messageType}`;
    return { kind: 'rtcm', name, text: `${name} (${f.length} B)` };
  });
  const errors: [keyof ErrorCounters, string][] = [
    ['nmeaChecksumErrors', 'NMEA checksum error'],
    ['ubxChecksumErrors', 'UBX checksum error'],
    ['rtcmCrcErrors', 'RTCM3 CRC error'],
  ];
  for (const [key, text] of errors) {
    for (let i = before[key]; i < after[key]; i++)
      entries.push({ kind: 'error', name: text, text });
  }
  return entries;
}
