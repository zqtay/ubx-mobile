import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { constellationMeta, svLabel, type SvLabelStyle } from '@/domain/constellations';
import type { Satellite } from '@/domain/types';
import { AppText } from '@/ui/components';
import { DASH } from '@/ui/format';
import { cn0Color } from '@/ui/theme/cn0Scale';
import { useAppTheme } from '@/ui/theme/ThemeProvider';
import { spacing } from '@/ui/theme/tokens';

/** Y axis range and gridlines (functional spec §4.3). */
export const CHART_MAX_CN0 = 55;
const GRID = [0, 10, 20, 30, 40, 50];
const PLOT_HEIGHT = 220;
const AXIS_WIDTH = 28;
const SINGLE_BAR = 16;
const MULTI_BAR = 8;
const SV_GAP = 6;

export interface SignalChartProps {
  sats: readonly Satellite[];
  labelStyle: SvLabelStyle;
  onPress: (key: string) => void;
}

interface Bar {
  cn0: number | undefined;
  used: boolean;
  label?: string;
}

/** Bars of one satellite: one per signal when it has several (functional spec §4.3). */
export function barsOf(sat: Satellite): Bar[] {
  if (sat.signals.length > 1) {
    return sat.signals.map((s) => ({
      cn0: s.cn0,
      used: s.used ?? sat.used === true,
      label: s.label,
    }));
  }
  return [{ cn0: sat.cn0, used: sat.used === true }];
}

/**
 * C/N0 bar chart (REQ-SAT-11): satellites grouped by constellation in list order, bars coloured by
 * the C/N0 scale, used satellites solid with an outline, unused faded. Tap a satellite for detail.
 */
export function SignalChart({ sats, labelStyle, onPress }: SignalChartProps) {
  const { t } = useTranslation();
  const { colors } = useAppTheme();
  const y = (cn0: number) => (Math.min(cn0, CHART_MAX_CN0) / CHART_MAX_CN0) * PLOT_HEIGHT;

  return (
    <View style={styles.container} testID="signal-chart">
      <View style={[styles.axis, { height: PLOT_HEIGHT }]}>
        {GRID.map((g) => (
          <AppText key={g} variant="caption" muted style={[styles.axisLabel, { bottom: y(g) - 8 }]}>
            {g}
          </AppText>
        ))}
      </View>
      <ScrollView horizontal contentContainerStyle={styles.scroll}>
        <View>
          <View style={{ height: PLOT_HEIGHT }}>
            {GRID.map((g) => (
              <View
                key={g}
                style={[styles.grid, { bottom: y(g), backgroundColor: colors.border }]}
              />
            ))}
            <View style={styles.columns}>
              {sats.map((sat, i) => {
                const bars = barsOf(sat);
                const label = svLabel(sat.constellation, sat.svid, labelStyle, sat.glonassFcn);
                const newGroup = i > 0 && sats[i - 1].constellation !== sat.constellation;
                return (
                  <Pressable
                    key={sat.key}
                    testID={`chart-sv-${sat.key}`}
                    accessibilityRole="button"
                    accessibilityLabel={t('satellites.chartA11y', {
                      label,
                      constellation: constellationMeta(sat.constellation).name,
                      cn0: bars.map((b) => (b.cn0 ? Math.round(b.cn0) : DASH)).join(', '),
                      used: sat.used ? t('satellites.usedA11y') : '',
                    })}
                    onPress={() => onPress(sat.key)}
                    style={[styles.column, newGroup && { marginLeft: SV_GAP * 3 }]}>
                    {bars.map((b, j) => (
                      <View
                        key={j}
                        style={[
                          styles.bar,
                          {
                            width: bars.length > 1 ? MULTI_BAR : SINGLE_BAR,
                            height: b.cn0 ? Math.max(2, y(b.cn0)) : 0,
                            backgroundColor: cn0Color(b.cn0),
                            opacity: b.used ? 1 : 0.4,
                            borderColor: b.used ? colors.text : 'transparent',
                          },
                        ]}
                      />
                    ))}
                  </Pressable>
                );
              })}
            </View>
          </View>
          <View style={styles.labels}>
            {sats.map((sat, i) => {
              const bars = barsOf(sat);
              const width = bars.length * (bars.length > 1 ? MULTI_BAR : SINGLE_BAR);
              const newGroup = i > 0 && sats[i - 1].constellation !== sat.constellation;
              return (
                <AppText
                  key={sat.key}
                  variant="caption"
                  numberOfLines={1}
                  style={[
                    styles.svLabel,
                    { width: Math.max(width, 24) },
                    newGroup && { marginLeft: SV_GAP * 3 },
                    sat.used ? styles.bold : undefined,
                  ]}>
                  {svLabel(sat.constellation, sat.svid, labelStyle, sat.glonassFcn)}
                </AppText>
              );
            })}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    paddingVertical: spacing.md,
    paddingRight: spacing.lg,
  },
  axis: {
    width: AXIS_WIDTH,
  },
  axisLabel: {
    position: 'absolute',
    right: 4,
  },
  scroll: {
    paddingRight: spacing.lg,
  },
  grid: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
  },
  columns: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: SV_GAP,
  },
  column: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    minWidth: 24,
    justifyContent: 'center',
    height: '100%',
  },
  bar: {
    borderWidth: 1,
    borderTopLeftRadius: 2,
    borderTopRightRadius: 2,
  },
  labels: {
    flexDirection: 'row',
    gap: SV_GAP,
    marginTop: spacing.xs,
  },
  svLabel: {
    textAlign: 'center',
    minWidth: 24,
  },
  bold: {
    fontWeight: '700',
  },
});
