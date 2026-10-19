import { create } from 'zustand';

import type { Constellation, GnssSnapshot } from '@/domain/types';

import { useGnssStore } from './gnssStore';
import { useSettings, type SkyTrails } from './settingsStore';

export interface TrailPoint {
  atMs: number;
  elevation: number;
  azimuth: number;
}

export interface Trail {
  constellation: Constellation;
  points: TrailPoint[];
}

/** Sampling interval of trails (functional spec §5.5). */
export const TRAIL_SAMPLE_MS = 10_000;

export const TRAIL_DURATION_MS: Record<SkyTrails, number> = {
  off: 0,
  '10m': 10 * 60_000,
  '1h': 60 * 60_000,
};

interface TrailState {
  trails: ReadonlyMap<string, Trail>;
  lastSampleMs: number | undefined;
  source: string | undefined;
}

/** Recent sky positions per satellite (REQ-SKY-10). Memory only. */
export const useSkyTrails = create<TrailState>(() => ({
  trails: new Map(),
  lastSampleMs: undefined,
  source: undefined,
}));

/** Next trail state for a snapshot at wall-clock `nowMs` (pure, for tests). */
export function nextTrails(
  state: TrailState,
  snapshot: Pick<GnssSnapshot, 'source' | 'satellites' | 'stale'>,
  nowMs: number,
  durationMs: number,
): TrailState {
  const source = snapshot.source ?? undefined;
  if (durationMs <= 0) {
    if (state.trails.size === 0 && state.source === source) return state;
    return { trails: new Map(), lastSampleMs: undefined, source };
  }
  // A new source starts new trails.
  if (source !== state.source) state = { trails: new Map(), lastSampleMs: undefined, source };
  if (snapshot.stale) return state;
  if (state.lastSampleMs !== undefined && nowMs - state.lastSampleMs < TRAIL_SAMPLE_MS)
    return state;

  const cutoff = nowMs - durationMs;
  const trails = new Map<string, Trail>();
  for (const [key, trail] of state.trails) {
    const points = trail.points.filter((p) => p.atMs >= cutoff);
    if (points.length > 0) trails.set(key, { ...trail, points });
  }
  for (const s of snapshot.satellites) {
    if (s.elevation === undefined || s.azimuth === undefined || s.elevation < 0) continue;
    const previous = trails.get(s.key);
    trails.set(s.key, {
      constellation: s.constellation,
      points: [
        ...(previous?.points ?? []),
        { atMs: nowMs, elevation: s.elevation, azimuth: s.azimuth },
      ],
    });
  }
  return { trails, lastSampleMs: nowMs, source };
}

/** Records trails from the GNSS store while trails are enabled. Returns a stop function. */
export function startSkyTrailRecorder(now: () => number = Date.now): () => void {
  const update = () => {
    const state = useSkyTrails.getState();
    const next = nextTrails(
      state,
      useGnssStore.getState(),
      now(),
      TRAIL_DURATION_MS[useSettings.getState().skyTrails],
    );
    if (next !== state) useSkyTrails.setState(next, true);
  };
  const unsubscribe = [useGnssStore.subscribe(update), useSettings.subscribe(update)];
  return () => unsubscribe.forEach((u) => u());
}
