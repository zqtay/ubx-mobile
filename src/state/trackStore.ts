import { create } from 'zustand';

import type { GnssSnapshot } from '@/domain/types';

import { useGnssStore } from './gnssStore';

export interface TrackPoint {
  lat: number;
  lon: number;
  atMs: number;
}

/** Oldest points are dropped beyond this (functional spec §12.1). */
export const MAX_TRACK_POINTS = 2000;
/** A new point is added only after moving this far, so a still receiver does not fill the track. */
export const MIN_TRACK_STEP_M = 1;

interface TrackState {
  points: TrackPoint[];
  /** Identifies the session the points belong to. */
  sessionKey: string | undefined;
}

/** Session track for the Map screen (REQ-MAP-07). Memory only. */
export const useTrack = create<TrackState>(() => ({ points: [], sessionKey: undefined }));

function distanceM(a: TrackPoint, b: TrackPoint): number {
  const rad = Math.PI / 180;
  const x = (b.lon - a.lon) * rad * Math.cos(((a.lat + b.lat) / 2) * rad);
  const y = (b.lat - a.lat) * rad;
  return Math.hypot(x, y) * 6371008.8;
}

const sessionKeyOf = (s: GnssSnapshot) =>
  s.source ? `${s.source}:${s.session?.startedAtMs ?? ''}` : undefined;

/** Next track state for a new snapshot (pure, for tests). */
export function nextTrack(state: TrackState, snapshot: GnssSnapshot): TrackState {
  const sessionKey = sessionKeyOf(snapshot);
  const points = sessionKey === state.sessionKey ? state.points : [];
  const fix = snapshot.fix;
  if (
    snapshot.stale ||
    !fix ||
    fix.fixType === 'none' ||
    fix.fixType === 'time-only' ||
    fix.lat === undefined ||
    fix.lon === undefined
  ) {
    return points === state.points ? state : { points, sessionKey };
  }
  const point = { lat: fix.lat, lon: fix.lon, atMs: fix.receivedAtMs };
  const last = points.at(-1);
  if (last && (last.atMs === point.atMs || distanceM(last, point) < MIN_TRACK_STEP_M)) {
    return points === state.points ? state : { points, sessionKey };
  }
  return { points: [...points, point].slice(-MAX_TRACK_POINTS), sessionKey };
}

/** Records the track from the GNSS store. Returns a function that stops recording. */
export function startTrackRecorder(): () => void {
  return useGnssStore.subscribe((snapshot) => {
    const state = useTrack.getState();
    const next = nextTrack(state, snapshot);
    if (next !== state) useTrack.setState(next, true);
  });
}
