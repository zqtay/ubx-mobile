import type { MessageStat } from '@/domain/types';

import type { DecodedFrame } from './stream/StreamDecoder';
import { ubxMessageName } from './ubx/ids';

/** Display name of a frame: `UBX-NAV-PVT`, `GNGSV`, `PUBX`, `RTCM3 1005`. */
export function frameName(frame: DecodedFrame): string {
  switch (frame.kind) {
    case 'ubx':
      return ubxMessageName(frame.cls, frame.id);
    case 'rtcm3':
      return `RTCM3 ${frame.messageType}`;
    case 'nmea': {
      // The address field: up to the first comma, or the checksum for field-less sentences.
      const end = frame.text.search(/[,*]/);
      return frame.text.slice(1, end > 0 ? end : undefined);
    }
  }
}

const PROTOCOL = { ubx: 'UBX', nmea: 'NMEA', rtcm3: 'RTCM3' } as const;

interface Entry {
  protocol: MessageStat['protocol'];
  count: number;
  lastMs: number;
  /** Receive times within the rate window. */
  times: number[];
}

/**
 * Per-message counts and rates, plus throughput, for the Device screen (REQ-DEV-08,
 * functional spec §7.2). Rates are counted over a sliding window.
 */
export class MessageTracker {
  private readonly entries = new Map<string, Entry>();
  private bytes: { t: number; n: number }[] = [];

  constructor(private readonly windowMs = 5000) {}

  recordBytes(n: number, rxMs: number): void {
    this.bytes.push({ t: rxMs, n });
    this.trimBytes(rxMs);
  }

  record(frame: DecodedFrame): void {
    const name = frameName(frame);
    let entry = this.entries.get(name);
    if (!entry) {
      entry = { protocol: PROTOCOL[frame.kind], count: 0, lastMs: frame.rxMs, times: [] };
      this.entries.set(name, entry);
    }
    entry.count += 1;
    entry.lastMs = frame.rxMs;
    entry.times.push(frame.rxMs);
    this.trim(entry.times, frame.rxMs);
  }

  snapshot(nowMs: number): { messages: MessageStat[]; bytesPerSecond: number } {
    const seconds = this.windowMs / 1000;
    const messages: MessageStat[] = [];
    for (const [name, e] of this.entries) {
      this.trim(e.times, nowMs);
      messages.push({
        name,
        protocol: e.protocol,
        count: e.count,
        lastMs: e.lastMs,
        rateHz: e.times.length / seconds,
      });
    }
    messages.sort((a, b) => a.protocol.localeCompare(b.protocol) || a.name.localeCompare(b.name));
    this.trimBytes(nowMs);
    const total = this.bytes.reduce((sum, b) => sum + b.n, 0);
    return { messages, bytesPerSecond: total / seconds };
  }

  reset(): void {
    this.entries.clear();
    this.bytes = [];
  }

  private trim(times: number[], nowMs: number): void {
    const cutoff = nowMs - this.windowMs;
    let drop = 0;
    while (drop < times.length && times[drop] <= cutoff) drop++;
    if (drop > 0) times.splice(0, drop);
  }

  private trimBytes(nowMs: number): void {
    const cutoff = nowMs - this.windowMs;
    let drop = 0;
    while (drop < this.bytes.length && this.bytes[drop].t <= cutoff) drop++;
    if (drop > 0) this.bytes.splice(0, drop);
  }
}
