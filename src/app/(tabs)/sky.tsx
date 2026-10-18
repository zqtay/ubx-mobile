import { router } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import { averageCn0, hasSkyPosition } from '@/state/selectors';
import { useSettings } from '@/state/settingsStore';
import { AppText, Card, DataGate } from '@/ui/components';
import { useSatelliteView } from '@/ui/hooks/useSatelliteView';
import { FilterBar } from '@/ui/satellites/FilterBar';
import { Cn0Gauge } from '@/ui/sky/Cn0Gauge';
import { Legend } from '@/ui/sky/Legend';
import { SkyPlot } from '@/ui/sky/SkyPlot';
import { spacing } from '@/ui/theme/tokens';

export default function SkyScreen() {
  const { t } = useTranslation();
  return (
    <DataGate icon="radar" placeholder={t('screens.sky.placeholder')}>
      <SkyContent />
    </DataGate>
  );
}

function SkyContent() {
  const { t } = useTranslation();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const [width, setWidth] = useState(windowWidth);
  const { filtered, counts, filter, labelStyle } = useSatelliteView();
  const showLabels = useSettings((s) => s.skyLabels);
  const denseGrid = useSettings((s) => s.skyDenseGrid);

  const landscape = windowWidth > windowHeight;
  const contentWidth = width - spacing.lg * 2;
  // Landscape/tablet: plot on the left (height-limited), gauge and legend beside it (FS §5.1).
  const plotSize = landscape ? Math.min(contentWidth * 0.55, windowHeight - 200) : contentWidth;
  const sideWidth = landscape ? contentWidth - plotSize - spacing.lg : contentWidth;

  const plotted = useMemo(() => filtered.filter(hasSkyPosition), [filtered]);
  const average = useMemo(() => averageCn0(filtered), [filtered]);
  const withoutPosition = filtered.length - plotted.length;
  const openDetail = useCallback((key: string) => {
    router.push({ pathname: '/satellite/[key]', params: { key } });
  }, []);

  return (
    <ScrollView
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      contentContainerStyle={styles.content}>
      <FilterBar counts={counts} filter={filter} />
      <View style={[styles.body, landscape && styles.row]}>
        <View style={styles.plot}>
          <SkyPlot
            satellites={plotted}
            size={Math.max(200, plotSize)}
            labelStyle={labelStyle}
            showLabels={showLabels}
            denseGrid={denseGrid}
            onSelect={openDetail}
          />
          {withoutPosition > 0 ? (
            <AppText variant="caption" muted style={styles.note}>
              {t('sky.noPosition', { count: withoutPosition })}
            </AppText>
          ) : null}
        </View>
        <View style={[styles.side, { width: sideWidth }]}>
          <Card>
            <Cn0Gauge average={average} width={sideWidth - spacing.lg * 2} />
          </Card>
          <Card>
            <Legend width={sideWidth - spacing.lg * 2} />
          </Card>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingLeft: spacing.lg,
    paddingBottom: spacing.xl,
  },
  body: {
    gap: spacing.md,
    paddingRight: spacing.lg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  plot: {
    alignItems: 'center',
    gap: spacing.xs,
  },
  side: {
    gap: spacing.md,
  },
  note: {
    textAlign: 'center',
  },
});
