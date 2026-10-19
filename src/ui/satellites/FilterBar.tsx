import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';

import { constellationMeta } from '@/domain/constellations';
import type { Constellation } from '@/domain/types';
import type { CountSummary } from '@/state/selectors';
import { useSettings, type SatelliteFilterSettings } from '@/state/settingsStore';
import { AppText, Chip } from '@/ui/components';
import { ConstellationBadge } from '@/ui/components/ShapeIcon';
import { spacing } from '@/ui/theme/tokens';

export interface FilterBarProps {
  counts: CountSummary;
  filter: SatelliteFilterSettings;
  /** Show the "Used only" / "Has signal" toggles. */
  showToggles?: boolean;
  /** Element at the end of the summary line (e.g. the list/chart toggle). */
  trailing?: ReactNode;
}

/**
 * Summary counts, constellation chips (multi-select, with used/view counts) and filter toggles
 * (REQ-SAT-07, REQ-SAT-08). The filter is persisted and shared with the Sky view.
 */
export function FilterBar({ counts, filter, showToggles = true, trailing }: FilterBarProps) {
  const { t } = useTranslation();
  const updateFilter = useSettings((s) => s.updateSatelliteFilter);
  const selected = new Set(filter.constellations);

  const toggle = (c: Constellation) => {
    const next = new Set(selected);
    if (next.has(c)) next.delete(c);
    else next.add(c);
    updateFilter({ constellations: [...next] });
  };

  return (
    <View style={styles.container}>
      <View style={styles.summary}>
        <AppText variant="label" muted testID="satellite-summary" style={styles.flex}>
          {t('satellites.summary', {
            used: counts.total.used,
            signal: counts.total.withSignal,
            view: counts.total.inView,
          })}
        </AppText>
        {trailing}
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chips}>
        <Chip
          testID="filter-all"
          label={t('satellites.all')}
          selected={selected.size === 0}
          onPress={() => updateFilter({ constellations: [] })}
        />
        {[
          ...counts.byConstellation,
          // Keep selected constellations visible even when they have no satellites right now.
          ...filter.constellations
            .filter((c) => !counts.byConstellation.some((b) => b.constellation === c))
            .map((constellation) => ({
              constellation,
              counts: { inView: 0, withSignal: 0, used: 0 },
            })),
        ].map(({ constellation, counts: c }) => {
          const meta = constellationMeta(constellation);
          return (
            <Chip
              key={constellation}
              testID={`filter-${constellation}`}
              icon={<ConstellationBadge constellation={constellation} size={12} />}
              label={`${meta.short} ${c.used}/${c.inView}`}
              accessibilityLabel={`${meta.name}, ${c.used} used of ${c.inView}`}
              selected={selected.has(constellation)}
              onPress={() => toggle(constellation)}
            />
          );
        })}
        {showToggles ? (
          <>
            <View style={styles.separator} />
            <Chip
              testID="filter-used"
              label={t('satellites.usedOnly')}
              selected={filter.usedOnly}
              onPress={() => updateFilter({ usedOnly: !filter.usedOnly })}
            />
            <Chip
              testID="filter-signal"
              label={t('satellites.hasSignal')}
              selected={filter.hasSignalOnly}
              onPress={() => updateFilter({ hasSignalOnly: !filter.hasSignalOnly })}
            />
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.sm,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  chips: {
    gap: spacing.sm,
    paddingRight: spacing.lg,
    alignItems: 'center',
  },
  separator: {
    width: spacing.xs,
  },
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: spacing.sm,
  },
  flex: {
    flex: 1,
  },
});
