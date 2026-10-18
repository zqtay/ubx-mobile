import { AppState, type AppStateStatus, type NativeEventSubscription } from 'react-native';

import { GnssAccumulator } from '@/state/GnssAccumulator';
import { emptySnapshot, startCommitLoop, useGnssStore } from '@/state/gnssStore';

import type { GnssSource } from './GnssSource';

export interface SourceManagerOptions {
  refreshHz: number;
  satelliteTimeoutMs: number;
}

/**
 * Owns at most one active source, the accumulator and the commit loop (technical spec §2, §8.4).
 * Switching sources stops the previous one and clears its data (REQ-SRC-02). Sources are
 * suspended in the background and resumed in the foreground (REQ-NFR-08).
 */
export class SourceManager {
  private readonly accumulator: GnssAccumulator;
  private refreshHz: number;
  private active?: GnssSource;
  private stopCommit?: () => void;
  private appState?: NativeEventSubscription;
  private suspended = false;

  constructor(options: SourceManagerOptions) {
    this.refreshHz = options.refreshHz;
    this.accumulator = new GnssAccumulator({ satelliteTimeoutMs: options.satelliteTimeoutMs });
  }

  get current(): GnssSource | undefined {
    return this.active;
  }

  async start(source: GnssSource): Promise<void> {
    await this.stop();
    this.active = source;
    this.accumulator.start(source.kind);
    this.stopCommit = startCommitLoop(this.accumulator, this.refreshHz);
    this.appState ??= AppState.addEventListener('change', (s) => void this.onAppState(s));
    try {
      await source.start((e) => {
        if (this.active === source) this.accumulator.apply(e);
      });
    } catch (error) {
      this.accumulator.apply({
        t: 'connection',
        state: {
          kind: 'error',
          code: 'E_IO',
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  /** Stops the active source and clears all data. */
  async stop(): Promise<void> {
    const source = this.active;
    this.active = undefined;
    this.stopCommit?.();
    this.stopCommit = undefined;
    this.suspended = false;
    if (source) await source.stop();
    useGnssStore.setState(emptySnapshot(), true);
  }

  setRefreshRate(hz: number): void {
    this.refreshHz = hz;
    if (this.stopCommit) {
      this.stopCommit();
      this.stopCommit = startCommitLoop(this.accumulator, hz);
    }
  }

  setSatelliteTimeout(ms: number): void {
    this.accumulator.setSatelliteTimeout(ms);
  }

  /** Clears satellites and TTFF after a receiver restart (REQ-CFG-14). */
  restartSession(): void {
    this.accumulator.restartSession();
  }

  dispose(): void {
    void this.stop();
    this.appState?.remove();
    this.appState = undefined;
  }

  private async onAppState(state: AppStateStatus): Promise<void> {
    const source = this.active;
    if (!source) return;
    if (state === 'background' && !this.suspended) {
      this.suspended = true;
      await (source.suspend ? source.suspend() : source.stop());
    } else if (state === 'active' && this.suspended) {
      this.suspended = false;
      if (source.resume) await source.resume();
      else await this.start(source);
    }
  }
}
