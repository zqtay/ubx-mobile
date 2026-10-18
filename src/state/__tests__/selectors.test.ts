import type { Satellite } from '@/domain/types';

import {
  averageCn0,
  countSatellites,
  filterSatellites,
  hasSignal,
  hasSkyPosition,
  sortSatellites,
} from '../selectors';

const sat = (key: string, extra: Partial<Satellite> = {}): Satellite => {
  const [constellation, svid] = key.split(':');
  return {
    key,
    constellation: constellation as Satellite['constellation'],
    svid: Number(svid),
    signals: [],
    origin: 'ubx-nav-sat',
    originUpdatedMs: 0,
    lastSeenMs: 0,
    ...extra,
  };
};

const SATS: Satellite[] = [
  sat('GPS:14', { cn0: 41, elevation: 47, azimuth: 312, used: true }),
  sat('GPS:30', { cn0: 21, elevation: 17, azimuth: 330, used: false }),
  sat('GPS:2', { cn0: 0, elevation: undefined, azimuth: undefined }),
  sat('GALILEO:16', { cn0: 26, elevation: 12, azimuth: 304, used: true }),
  sat('BEIDOU:21', { cn0: 24, elevation: -2, azimuth: 277 }),
];

describe('satellite selectors', () => {
  it('classifies signal and sky position', () => {
    expect(hasSignal(SATS[0])).toBe(true);
    expect(hasSignal(SATS[2])).toBe(false);
    expect(hasSkyPosition(SATS[0])).toBe(true);
    expect(hasSkyPosition(SATS[2])).toBe(false);
    expect(hasSkyPosition(SATS[4])).toBe(false); // below the horizon
  });

  it('filters by constellation, used and signal (REQ-SAT-07)', () => {
    expect(filterSatellites(SATS, {}).length).toBe(5);
    expect(filterSatellites(SATS, { constellations: [] }).length).toBe(5);
    expect(
      filterSatellites(SATS, { constellations: ['GALILEO', 'BEIDOU'] }).map((s) => s.key),
    ).toEqual(['GALILEO:16', 'BEIDOU:21']);
    expect(filterSatellites(SATS, { usedOnly: true }).map((s) => s.key)).toEqual([
      'GPS:14',
      'GALILEO:16',
    ]);
    expect(filterSatellites(SATS, { hasSignalOnly: true }).map((s) => s.key)).not.toContain(
      'GPS:2',
    );
  });

  it('sorts by each key with stable tie-breaking (REQ-SAT-06)', () => {
    const keys = (sort: Parameters<typeof sortSatellites>[1]) =>
      sortSatellites(SATS, sort).map((s) => s.key);
    expect(keys('sv')).toEqual(['GPS:2', 'GPS:14', 'GPS:30', 'GALILEO:16', 'BEIDOU:21']);
    expect(keys('cn0')).toEqual(['GPS:14', 'GALILEO:16', 'BEIDOU:21', 'GPS:30', 'GPS:2']);
    expect(keys('elevation')).toEqual(['GPS:14', 'GPS:30', 'GALILEO:16', 'BEIDOU:21', 'GPS:2']);
    expect(keys('azimuth')).toEqual(['BEIDOU:21', 'GALILEO:16', 'GPS:14', 'GPS:30', 'GPS:2']);
    expect(keys('used')).toEqual(['GPS:14', 'GALILEO:16', 'BEIDOU:21', 'GPS:30', 'GPS:2']);
    expect(sortSatellites(SATS, 'cn0')).not.toBe(SATS);
  });

  it('counts per constellation in display order (REQ-SAT-08)', () => {
    const counts = countSatellites(SATS);
    expect(counts.total).toEqual({ inView: 5, withSignal: 4, used: 2 });
    expect(counts.byConstellation).toEqual([
      { constellation: 'GPS', counts: { inView: 3, withSignal: 2, used: 1 } },
      { constellation: 'GALILEO', counts: { inView: 1, withSignal: 1, used: 1 } },
      { constellation: 'BEIDOU', counts: { inView: 1, withSignal: 1, used: 0 } },
    ]);
  });

  it('averages C/N0 over satellites with signal and over used ones (REQ-SKY-07)', () => {
    expect(averageCn0(SATS)).toEqual({ inView: (41 + 21 + 26 + 24) / 4, used: (41 + 26) / 2 });
    expect(averageCn0([])).toEqual({ inView: undefined, used: undefined });
  });
});
