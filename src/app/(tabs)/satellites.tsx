import { FlashList } from '@shopify/flash-list';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';

import type { Satellite } from '@/domain/types';
import type { SatelliteSort } from '@/state/selectors';
import { useSettings } from '@/state/settingsStore';
import { AppText, DataGate } from '@/ui/components';
import { useSatelliteView } from '@/ui/hooks/useSatelliteView';
import { FilterBar } from '@/ui/satellites/FilterBar';
import { COLUMNS, SatelliteRow } from '@/ui/satellites/SatelliteRow';
import { useAppTheme } from '@/ui/theme/ThemeProvider';
import { minTouchTarget, spacing } from '@/ui/theme/tokens';

/** How long re-sorting stays frozen after the user stops touching the list (functional spec §4.5). */
const SORT_FREEZE_MS = 1000;

export default function SatellitesScreen() {
  const { t } = useTranslation();
  return (
    <DataGate icon="satellite-variant" placeholder={t('screens.satellites.placeholder')}>
      <SatelliteList />
    </DataGate>
  );
}

function SatelliteList() {
  const { t } = useTranslation();
  const { colors } = useAppTheme();
  const { sorted, counts, filter, sort, labelStyle, all } = useSatelliteView();
  const rows = useFrozenOrder(sorted);
  const openDetail = useCallback((key: string) => {
    router.push({ pathname: '/satellite/[key]', params: { key } });
  }, []);

  return (
    <View style={styles.fill}>
      <View style={[styles.top, { backgroundColor: colors.bg }]}>
        <FilterBar counts={counts} filter={filter} />
      </View>
      <ColumnHeader sort={sort} />
      <FlashList
        testID="satellite-list"
        data={rows.items}
        keyExtractor={(s) => s.key}
        renderItem={({ item }) => (
          <SatelliteRow sat={item} labelStyle={labelStyle} onPress={openDetail} />
        )}
        extraData={labelStyle}
        onTouchStart={rows.freeze}
        onTouchEnd={rows.release}
        onScrollBeginDrag={rows.freeze}
        onMomentumScrollEnd={rows.release}
        ListEmptyComponent={
          <AppText muted style={styles.empty}>
            {all.length === 0 ? t('satellites.searching') : t('satellites.noMatch')}
          </AppText>
        }
      />
    </View>
  );
}

const SORT_COLUMNS: { key: SatelliteSort; labelKey: string; width?: number }[] = [
  { key: 'sv', labelKey: 'satellites.colSv', width: COLUMNS.sv },
  { key: 'cn0', labelKey: 'satellites.colCn0', width: COLUMNS.cn0 },
  { key: 'elevation', labelKey: 'satellites.colEl', width: COLUMNS.el },
  { key: 'azimuth', labelKey: 'satellites.colAz', width: COLUMNS.az },
  { key: 'used', labelKey: 'satellites.colFlags' },
];

/** Sticky column header; tapping a column sorts by it (REQ-SAT-06). */
function ColumnHeader({ sort }: { sort: SatelliteSort }) {
  const { t } = useTranslation();
  const { colors } = useAppTheme();
  const update = useSettings((s) => s.update);
  return (
    <View
      accessibilityRole="tablist"
      style={[styles.header, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      {SORT_COLUMNS.map((c) => {
        const active = sort === c.key;
        const label = t(c.labelKey as 'satellites.colSv');
        return (
          <Pressable
            key={c.key}
            testID={`sort-${c.key}`}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={t('satellites.sortedBy', { column: label })}
            onPress={() => update({ satelliteSort: c.key })}
            style={[styles.headerCell, c.width ? { width: c.width } : styles.flagsCell]}>
            <AppText
              variant="label"
              color={active ? colors.primary : colors.textMuted}
              style={active ? styles.activeHeader : undefined}>
              {active ? `${label} ▾` : label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * Keeps the row order fixed while the user touches or scrolls the list, and for a moment
 * afterwards, so rows don't jump under the finger; contents still update (functional spec §4.5).
 */
function useFrozenOrder(sorted: Satellite[]) {
  const [frozenKeys, setFrozenKeys] = useState<string[] | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef(sorted);

  useEffect(() => {
    latest.current = sorted;
  });
  useEffect(() => () => clearTimeout(timer.current), []);

  const freeze = useCallback(() => {
    clearTimeout(timer.current);
    setFrozenKeys((keys) => keys ?? latest.current.map((s) => s.key));
  }, []);
  const release = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setFrozenKeys(null), SORT_FREEZE_MS);
  }, []);

  let items = sorted;
  if (frozenKeys) {
    const byKey = new Map(sorted.map((s) => [s.key, s]));
    const kept = frozenKeys.map((k) => byKey.get(k)).filter((s): s is Satellite => s !== undefined);
    const keptKeys = new Set(frozenKeys);
    items = [...kept, ...sorted.filter((s) => !keptKeys.has(s.key))];
  }
  return { items, freeze, release };
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  top: {
    paddingLeft: spacing.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
    minHeight: minTouchTarget - 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerCell: {
    minHeight: minTouchTarget - 8,
    justifyContent: 'center',
  },
  flagsCell: {
    flex: 1,
    alignItems: 'flex-end',
  },
  activeHeader: {
    fontWeight: '700',
  },
  empty: {
    textAlign: 'center',
    padding: spacing.xl,
  },
});
