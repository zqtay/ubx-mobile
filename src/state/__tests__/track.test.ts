import type { Fix, GnssSnapshot } from '@/domain/types';
import { emptySnapshot, useGnssStore } from '@/state/gnssStore';
import { MAX_TRACK_POINTS, nextTrack, startTrackRecorder, useTrack } from '@/state/trackStore';

const snap = (fix: Partial<Fix> | undefined, patch: Partial<GnssSnapshot> = {}): GnssSnapshot => ({
  ...emptySnapshot(),
  source: 'usb',
  session: { startedAtMs: 1 },
  fix: fix && { fixType: '3d', receivedAtMs: 0, ...fix },
  ...patch,
});

const empty = { points: [], sessionKey: undefined };

describe('session track (REQ-MAP-07)', () => {
  it('appends new positions that moved at least a metre', () => {
    let s = nextTrack(empty, snap({ lat: 1.3, lon: 103.8, receivedAtMs: 1 }));
    s = nextTrack(s, snap({ lat: 1.3, lon: 103.8, receivedAtMs: 1 })); // same fix
    s = nextTrack(s, snap({ lat: 1.300001, lon: 103.8, receivedAtMs: 2 })); // 0.1 m
    s = nextTrack(s, snap({ lat: 1.3001, lon: 103.8, receivedAtMs: 3 })); // 11 m
    expect(s.points.map((p) => p.atMs)).toEqual([1, 3]);
  });

  it('ignores fixes without a position, no-fix and stale data', () => {
    const before = nextTrack(empty, snap({ lat: 1, lon: 2, receivedAtMs: 1 }));
    expect(nextTrack(before, snap(undefined))).toBe(before);
    expect(nextTrack(before, snap({ fixType: 'none', lat: 5, lon: 5, receivedAtMs: 2 }))).toBe(
      before,
    );
    expect(nextTrack(before, snap({ lat: undefined, receivedAtMs: 2 }))).toBe(before);
    expect(nextTrack(before, snap({ lat: 5, lon: 5, receivedAtMs: 2 }, { stale: true }))).toBe(
      before,
    );
  });

  it('starts again for a new source or a receiver restart, and caps the length', () => {
    const s = nextTrack(empty, snap({ lat: 1, lon: 2, receivedAtMs: 1 }));
    expect(nextTrack(s, snap(undefined, { session: { startedAtMs: 2 } })).points).toEqual([]);
    expect(nextTrack(s, snap(undefined, { source: 'android' })).points).toEqual([]);
    let long = empty as ReturnType<typeof nextTrack>;
    for (let i = 0; i < MAX_TRACK_POINTS + 5; i++) {
      long = nextTrack(long, snap({ lat: i * 0.001, lon: 0, receivedAtMs: i + 1 }));
    }
    expect(long.points).toHaveLength(MAX_TRACK_POINTS);
    expect(long.points[0].atMs).toBe(6);
  });

  it('records from the GNSS store', () => {
    useTrack.setState(empty, true);
    const stop = startTrackRecorder();
    useGnssStore.setState(snap({ lat: 1, lon: 2, receivedAtMs: 9 }), true);
    stop();
    useGnssStore.setState(snap({ lat: 3, lon: 4, receivedAtMs: 10 }), true);
    expect(useTrack.getState().points).toEqual([{ lat: 1, lon: 2, atMs: 9 }]);
    useGnssStore.setState(emptySnapshot(), true);
  });
});
