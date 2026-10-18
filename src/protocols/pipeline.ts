import type { GnssEvent } from '@/domain/events';

import { NmeaInterpreter } from './nmea/interpreter';
import { StreamDecoder, type DecodedFrame } from './stream/StreamDecoder';
import { interpretUbx } from './ubx/interpreter';

/**
 * Byte stream → frames → normalised events, for transports that deliver raw receiver output
 * (USB serial, replayed logs). Transport-independent (requirements REQ-ARC-02).
 */
export class ProtocolPipeline {
  readonly decoder = new StreamDecoder();
  private readonly nmea = new NmeaInterpreter('nmea');
  private ubxSeen = false;

  push(chunk: Uint8Array, rxMs: number): { frames: DecodedFrame[]; events: GnssEvent[] } {
    const frames = this.decoder.push(chunk, rxMs);
    const events: GnssEvent[] = [];
    for (const frame of frames) {
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
    events.push({ t: 'stats', stats: { ...this.decoder.stats } });
    return { frames, events };
  }

  /** Emits events still buffered at the end of a stream. */
  flush(): GnssEvent[] {
    return this.nmea.flush();
  }
}
