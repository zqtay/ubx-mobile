import { constellationOrder } from '@/domain/constellations';
import type { Constellation, Satellite } from '@/domain/types';

import { compareSatellites } from './GnssAccumulator';

/**
 * Pure derivations shared by the Satellites and Sky screens, so both apply the same filter and
 * statistics (REQ-SAT-07, REQ-SAT-08, REQ-SKY-07).
 */

export interface SatelliteFilter {
  /** Constellations to show; empty or undefined shows all. */
  constellations?: readonly Constellation[];
  usedOnly?: boolean;
  hasSignalOnly?: boolean;
}

export type SatelliteSort = 'sv' | 'cn0' | 'elevation' | 'azimuth' | 'used';

export function hasSignal(sat: Satellite): boolean {
  return sat.cn0 !== undefined && sat.cn0 > 0;
}

/** Satellites with a plottable position (above the horizon, known az/el). */
export function hasSkyPosition(sat: Satellite): boolean {
  return sat.elevation !== undefined && sat.azimuth !== undefined && sat.elevation >= 0;
}

export function filterSatellites(sats: readonly Satellite[], filter: SatelliteFilter): Satellite[] {
  const allowed =
    filter.constellations && filter.constellations.length > 0
      ? new Set(filter.constellations)
      : undefined;
  return sats.filter(
    (s) =>
      (!allowed || allowed.has(s.constellation)) &&
      (!filter.usedOnly || s.used === true) &&
      (!filter.hasSignalOnly || hasSignal(s)),
  );
}

/** Sorts a copy. Ties fall back to constellation + SV number so the order is stable. */
export function sortSatellites(sats: readonly Satellite[], sort: SatelliteSort): Satellite[] {
  const byNumber = compareSatellites;
  const desc = (a: number | undefined, b: number | undefined) =>
    (b ?? -Infinity) - (a ?? -Infinity);
  const comparators: Record<SatelliteSort, (a: Satellite, b: Satellite) => number> = {
    sv: byNumber,
    cn0: (a, b) => desc(a.cn0, b.cn0) || byNumber(a, b),
    elevation: (a, b) => desc(a.elevation, b.elevation) || byNumber(a, b),
    azimuth: (a, b) => (a.azimuth ?? Infinity) - (b.azimuth ?? Infinity) || byNumber(a, b),
    used: (a, b) =>
      Number(b.used === true) - Number(a.used === true) || desc(a.cn0, b.cn0) || byNumber(a, b),
  };
  return [...sats].sort(comparators[sort]);
}

export interface SatelliteCounts {
  inView: number;
  withSignal: number;
  used: number;
}

export interface CountSummary {
  total: SatelliteCounts;
  /** Only constellations present in the data, in display order. */
  byConstellation: { constellation: Constellation; counts: SatelliteCounts }[];
}

export function countSatellites(sats: readonly Satellite[]): CountSummary {
  const total: SatelliteCounts = { inView: 0, withSignal: 0, used: 0 };
  const per = new Map<Constellation, SatelliteCounts>();
  for (const s of sats) {
    let c = per.get(s.constellation);
    if (!c) {
      c = { inView: 0, withSignal: 0, used: 0 };
      per.set(s.constellation, c);
    }
    for (const target of [total, c]) {
      target.inView += 1;
      if (hasSignal(s)) target.withSignal += 1;
      if (s.used) target.used += 1;
    }
  }
  const byConstellation = [...per.entries()]
    .sort(([a], [b]) => constellationOrder(a) - constellationOrder(b))
    .map(([constellation, counts]) => ({ constellation, counts }));
  return { total, byConstellation };
}

export interface AverageCn0 {
  /** Mean C/N0 of satellites with signal; undefined when there are none. */
  inView?: number;
  /** Mean C/N0 of satellites used in the fix. */
  used?: number;
}

export function averageCn0(sats: readonly Satellite[]): AverageCn0 {
  let sumView = 0;
  let nView = 0;
  let sumUsed = 0;
  let nUsed = 0;
  for (const s of sats) {
    if (!hasSignal(s)) continue;
    sumView += s.cn0!;
    nView += 1;
    if (s.used) {
      sumUsed += s.cn0!;
      nUsed += 1;
    }
  }
  return {
    inView: nView > 0 ? sumView / nView : undefined,
    used: nUsed > 0 ? sumUsed / nUsed : undefined,
  };
}
