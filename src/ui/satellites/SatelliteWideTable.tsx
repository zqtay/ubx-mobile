import { useRef, type ComponentRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { constellationMeta, flagEmoji, svLabel, type SvLabelStyle } from '@/domain/constellations';
import type { Satellite } from '@/domain/types';
import { AppText } from '@/ui/components';
import { ConstellationBadge } from '@/ui/components/ShapeIcon';
import { DASH } from '@/ui/format';
import { useAppTheme } from '@/ui/theme/ThemeProvider';
import { spacing } from '@/ui/theme/tokens';

import { Cn0Bar } from './Cn0Bar';

/** Window width from which the Satellites screen shows the wide table (functional spec §4.2). */
export const WIDE_TABLE_MIN_WIDTH = 600;

const ROW = 40;
const SV_WIDTH = 84;

type Bool = boolean | undefined;

interface Column {
  key: string;
  /** Header text (u-center column names). */
  title: string;
  width: number;
  cell: (s: Satellite) => string | { bool: Bool } | { cn0: number | undefined };
}

const anyCorrection = (s: Satellite): Bool =>
  s.corrections ? Object.values(s.corrections).some(Boolean) : undefined;

/**
 * Dense u-center style table for landscape and tablets (REQ-SAT-09): the SV column is pinned and
 * the other columns scroll horizontally.
 */
export function SatelliteWideTable({
  sats,
  labelStyle,
  showFlags,
  onPress,
}: {
  sats: readonly Satellite[];
  labelStyle: SvLabelStyle;
  showFlags: boolean;
  onPress: (key: string) => void;
}) {
  const { t } = useTranslation();
  const { colors } = useAppTheme();
  const header = useRef<ComponentRef<typeof ScrollView>>(null);

  const columns: Column[] = [
    {
      key: 'gnss',
      title: 'GNSS',
      width: 64,
      cell: (s) => constellationMeta(s.constellation).short,
    },
    {
      key: 'signal',
      title: t('satellites.colSignal'),
      width: 110,
      cell: (s) => (s.signals.length ? s.signals.map((g) => g.label).join(', ') : DASH),
    },
    { key: 'cn0', title: 'C/N0', width: 96, cell: (s) => ({ cn0: s.cn0 }) },
    {
      key: 'res',
      title: t('satellites.colResidual'),
      width: 72,
      cell: (s) => (s.prResidualM !== undefined ? `${s.prResidualM.toFixed(1)} m` : DASH),
    },
    { key: 'used', title: t('satellites.colUsed'), width: 52, cell: (s) => ({ bool: s.used }) },
    {
      key: 'qi',
      title: 'Qi',
      width: 36,
      cell: (s) => (s.quality !== undefined ? String(s.quality) : DASH),
    },
    {
      key: 'el',
      title: 'El',
      width: 44,
      cell: (s) => (s.elevation !== undefined ? `${s.elevation}°` : DASH),
    },
    {
      key: 'az',
      title: 'Az',
      width: 48,
      cell: (s) => (s.azimuth !== undefined ? `${s.azimuth}°` : DASH),
    },
    {
      key: 'orbit',
      title: t('satellites.colOrbit'),
      width: 96,
      cell: (s) => (s.orbitSource ? t(`detail.orbitValue.${s.orbitSource}`) : DASH),
    },
    {
      key: 'health',
      title: t('satellites.colHealth'),
      width: 64,
      cell: (s) => ({
        bool: s.health === undefined || s.health === 'unknown' ? undefined : s.health === 'healthy',
      }),
    },
    { key: 'dgnss', title: 'DGNSS', width: 60, cell: (s) => ({ bool: s.diffCorr }) },
    {
      key: 'corr',
      title: t('satellites.colCorr'),
      width: 52,
      cell: (s) => ({ bool: anyCorrection(s) }),
    },
    { key: 'eph', title: 'EPH', width: 48, cell: (s) => ({ bool: s.hasEphemeris }) },
    { key: 'alm', title: 'ALM', width: 48, cell: (s) => ({ bool: s.hasAlmanac }) },
    { key: 'aop', title: 'AOP', width: 48, cell: (s) => ({ bool: s.hasAop }) },
    { key: 'ano', title: 'ANO', width: 48, cell: (s) => ({ bool: s.hasAno }) },
  ];

  const renderCell = (value: ReturnType<Column['cell']>) => {
    if (typeof value === 'string') {
      return (
        <AppText variant="mono" numberOfLines={1}>
          {value}
        </AppText>
      );
    }
    if ('cn0' in value) return <Cn0Bar cn0={value.cn0} width={44} />;
    // u-center style: ● green Y / ● red N / ○ grey ? (letter, not colour alone).
    const { bool } = value;
    return (
      <AppText
        variant="mono"
        color={bool === undefined ? colors.textMuted : bool ? colors.success : colors.danger}>
        {bool === undefined ? '○ ?' : bool ? '● Y' : '● N'}
      </AppText>
    );
  };

  return (
    <ScrollView testID="satellite-wide-table" stickyHeaderIndices={[0]}>
      <View
        style={[
          styles.row,
          styles.headerRow,
          { backgroundColor: colors.surface, borderBottomColor: colors.border },
        ]}>
        <AppText variant="label" style={[styles.svCell, { width: SV_WIDTH }]}>
          SV
        </AppText>
        <ScrollView
          horizontal
          ref={header}
          scrollEnabled={false}
          showsHorizontalScrollIndicator={false}>
          <View style={styles.cells}>
            {columns.map((c) => (
              <AppText
                key={c.key}
                variant="label"
                numberOfLines={1}
                style={[styles.cell, { width: c.width }]}>
                {c.title}
              </AppText>
            ))}
          </View>
        </ScrollView>
      </View>

      <View style={styles.body}>
        <View style={{ width: SV_WIDTH }}>
          {sats.map((s) => {
            const label = svLabel(s.constellation, s.svid, labelStyle, s.glonassFcn);
            const flag = showFlags ? flagEmoji(s.constellation) : undefined;
            return (
              <Pressable
                key={s.key}
                testID={`wide-row-${s.key}`}
                accessibilityRole="button"
                accessibilityLabel={`${label}, ${constellationMeta(s.constellation).name}`}
                onPress={() => onPress(s.key)}
                style={[
                  styles.row,
                  styles.svCell,
                  { borderBottomColor: colors.border },
                  s.used && { backgroundColor: colors.infoBg },
                ]}>
                <ConstellationBadge constellation={s.constellation} />
                <AppText variant="mono" style={s.used ? styles.bold : undefined} numberOfLines={1}>
                  {flag ? `${flag}${label}` : label}
                </AppText>
              </Pressable>
            );
          })}
        </View>
        <ScrollView
          horizontal
          scrollEventThrottle={16}
          onScroll={(e) =>
            header.current?.scrollTo({ x: e.nativeEvent.contentOffset.x, animated: false })
          }>
          <View>
            {sats.map((s) => (
              <Pressable
                key={s.key}
                onPress={() => onPress(s.key)}
                style={[
                  styles.row,
                  styles.cells,
                  { borderBottomColor: colors.border },
                  s.used && { backgroundColor: colors.infoBg },
                ]}>
                {columns.map((c) => (
                  <View key={c.key} style={[styles.cell, { width: c.width }]}>
                    {renderCell(c.cell(s))}
                  </View>
                ))}
              </Pressable>
            ))}
          </View>
        </ScrollView>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: {
    height: ROW,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  body: {
    flexDirection: 'row',
  },
  svCell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingLeft: spacing.lg,
  },
  cells: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  cell: {
    paddingHorizontal: spacing.xs,
    justifyContent: 'center',
  },
  bold: {
    fontWeight: '700',
  },
});
