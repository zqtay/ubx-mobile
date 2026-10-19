import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { useGnssStore } from '@/state/gnssStore';
import { countSatellites, filterSatellites, sortSatellites } from '@/state/selectors';
import { useSettings } from '@/state/settingsStore';

/**
 * Satellites with the persisted filter and sort applied, plus counts. Shared by the Satellites
 * and Sky screens so both show the same subset (REQ-SAT-07).
 */
export function useSatelliteView() {
  const satellites = useGnssStore((s) => s.satellites);
  const { filter, sort, labelStyle, showFlags } = useSettings(
    useShallow((s) => ({
      filter: s.satelliteFilter,
      sort: s.satelliteSort,
      labelStyle: s.svLabelStyle,
      showFlags: s.showFlags,
    })),
  );
  const counts = useMemo(() => countSatellites(satellites), [satellites]);
  const filtered = useMemo(() => filterSatellites(satellites, filter), [satellites, filter]);
  const sorted = useMemo(() => sortSatellites(filtered, sort), [filtered, sort]);
  return { all: satellites, filtered, sorted, counts, filter, sort, labelStyle, showFlags };
}
