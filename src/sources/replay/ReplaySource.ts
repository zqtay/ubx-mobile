import type { SourceKind } from '@/domain/types';
import { ProtocolPipeline } from '@/protocols/pipeline';

import type { GnssEventSink, GnssSource } from '../GnssSource';

import { splitEpochs, type EpochRange } from './epochs';

export interface ReplayOptions {
  label: string;
  /** Playback speed multiplier (1 = real time). */
  speed?: number;
  /** Start again from the beginning at the end of the log. */
  loop?: boolean;
  /** Monotonic clock, injectable for tests. */
  now?: () => number;
}

/**
 * Plays a recorded NMEA/UBX log through the same protocol pipeline as the USB source, one epoch
 * per second (REQ-SRC-05). Used for demos, development and end-to-end tests.
 */
export class ReplaySource implements GnssSource {
  readonly kind: SourceKind = 'replay';
  readonly label: string;
  private readonly speed: number;
  private readonly loop: boolean;
  private readonly now: () => number;

  private bytes?: Uint8Array;
  private epochs: EpochRange[] = [];
  private index = 0;
  private pipeline = new ProtocolPipeline();
  private timer?: ReturnType<typeof setInterval>;
  private emit?: GnssEventSink;

  constructor(
    private readonly load: () => Uint8Array | Promise<Uint8Array>,
    options: ReplayOptions,
  ) {
    this.label = options.label;
    this.speed = options.speed ?? 1;
    this.loop = options.loop ?? true;
    this.now = options.now ?? (() => Date.now());
  }

  async start(emit: GnssEventSink): Promise<void> {
    this.emit = emit;
    emit({ t: 'connection', state: { kind: 'detecting' } });
    this.bytes = await this.load();
    this.epochs = splitEpochs(this.bytes);
    this.index = 0;
    this.pipeline = new ProtocolPipeline();
    if (this.epochs.length === 0) {
      emit({
        t: 'connection',
        state: { kind: 'error', code: 'E_NO_DATA', message: 'The log contains no GNSS data.' },
      });
      return;
    }
    this.play();
  }

  async stop(): Promise<void> {
    this.pause();
    this.emit?.({ t: 'connection', state: { kind: 'idle' } });
  }

  async suspend(): Promise<void> {
    this.pause();
  }

  async resume(): Promise<void> {
    if (this.bytes && this.emit && !this.timer) this.play();
  }

  private play(): void {
    this.step();
    this.timer = setInterval(() => this.step(), Math.max(20, Math.round(1000 / this.speed)));
  }

  private pause(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private step(): void {
    const emit = this.emit;
    const bytes = this.bytes;
    if (!emit || !bytes) return;
    if (this.index >= this.epochs.length) {
      if (!this.loop) {
        this.pause();
        emit({ t: 'connection', state: { kind: 'idle' } });
        return;
      }
      this.index = 0;
      this.pipeline = new ProtocolPipeline();
    }
    const { start, end } = this.epochs[this.index++];
    const { events } = this.pipeline.push(bytes.subarray(start, end), this.now());
    for (const e of events) emit(e);
    for (const e of this.pipeline.flush()) emit(e);
    emit({ t: 'connection', state: { kind: 'receiving' } });
  }
}
