import { create } from 'zustand';

import type { GnssSnapshot } from '@/domain/types';
import { emptyStreamStats } from '@/protocols/stream/StreamDecoder';

import type { GnssAccumulator } from './GnssAccumulator';

export function emptySnapshot(): GnssSnapshot {
  return {
    source: null,
    connection: { kind: 'idle' },
    satellites: [],
    device: { receiver: {} },
    stats: emptyStreamStats(),
    stale: false,
  };
}

/** Throttled, immutable view of the GNSS state for the UI (technical spec §7.3). */
export const useGnssStore = create<GnssSnapshot>(() => emptySnapshot());

/**
 * Commits the accumulator into the store at `hz` (REQ-NFR-03). Each tick prunes aged
 * satellites and publishes a new snapshot only when something changed.
 * Returns a function that stops the loop.
 */
export function startCommitLoop(accumulator: GnssAccumulator, hz: number): () => void {
  const tick = () => {
    accumulator.prune();
    if (accumulator.isDirty) useGnssStore.setState(accumulator.snapshot(), true);
  };
  tick();
  const handle = setInterval(tick, Math.max(50, Math.round(1000 / hz)));
  return () => clearInterval(handle);
}
