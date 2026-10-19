import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';

import { constellationMeta, flagEmoji, svLabel, type SvLabelStyle } from '@/domain/constellations';
import type { Satellite } from '@/domain/types';
import { AppText } from '@/ui/components';
import { ConstellationBadge } from '@/ui/components/ShapeIcon';
import { DASH } from '@/ui/format';
import { useAppTheme } from '@/ui/theme/ThemeProvider';
import { spacing } from '@/ui/theme/tokens';

import { Cn0Bar } from './Cn0Bar';

export const ROW_HEIGHT = 56;

/** Column widths shared by the header and rows. */
export const COLUMNS = { sv: 76, cn0: 98, el: 40, az: 44 } as const;

export interface SatelliteRowProps {
  sat: Satellite;
  labelStyle: SvLabelStyle;
  onPress: (key: string) => void;
  /** Show the operator's flag next to the label (Settings → Show constellation flags). */
  showFlag?: boolean;
}

/**
 * One satellite (functional spec §4.1): badge, label, C/N0 bar + value, El, Az and E/A/U flags.
 * Used satellites are bold on a tinted row, so "used" is not conveyed by colour alone.
 */
export const SatelliteRow = memo(function SatelliteRow({
  sat,
  labelStyle,
  onPress,
  showFlag,
}: SatelliteRowProps) {
  const { t } = useTranslation();
  const { colors } = useAppTheme();
  const label = svLabel(sat.constellation, sat.svid, labelStyle, sat.glonassFcn);
  const used = sat.used === true;
  const unhealthy = sat.health === 'unhealthy';
  const flagWords = [
    sat.hasEphemeris ? t('satellites.flagEphemeris') : undefined,
    sat.hasAlmanac ? t('satellites.flagAlmanac') : undefined,
    unhealthy ? t('satellites.flagUnhealthy') : undefined,
    sat.diffCorr ? t('satellites.flagDiff') : undefined,
  ].filter(Boolean);

  return (
    <Pressable
      testID={`sat-row-${sat.key}`}
      onPress={() => onPress(sat.key)}
      accessibilityRole="button"
      accessibilityLabel={t('satellites.rowA11y', {
        label,
        constellation: constellationMeta(sat.constellation).name,
        cn0: sat.cn0 ? Math.round(sat.cn0) : DASH,
        el: sat.elevation ?? DASH,
        az: sat.azimuth ?? DASH,
        used: used ? t('satellites.usedA11y') : '',
        flags: flagWords.length ? `, ${flagWords.join(', ')}` : '',
      })}
      android_ripple={{ color: colors.surfaceAlt }}
      style={[
        styles.row,
        { borderBottomColor: colors.border },
        used && { backgroundColor: colors.infoBg },
      ]}>
      <View style={[styles.sv, { width: COLUMNS.sv }]}>
        <ConstellationBadge constellation={sat.constellation} />
        <AppText variant="mono" style={used ? styles.bold : undefined} numberOfLines={1}>
          {showFlag && flagEmoji(sat.constellation)
            ? `${flagEmoji(sat.constellation)}${label}`
            : label}
        </AppText>
      </View>
      <View style={{ width: COLUMNS.cn0 }}>
        <Cn0Bar cn0={sat.cn0} width={52} />
        {sat.signals.length > 1 ? (
          <AppText variant="caption" muted>
            {t('satellites.multiSignal', { count: sat.signals.length })}
          </AppText>
        ) : null}
      </View>
      <AppText variant="mono" style={[styles.num, { width: COLUMNS.el }]}>
        {sat.elevation !== undefined ? `${sat.elevation}°` : DASH}
      </AppText>
      <AppText variant="mono" style={[styles.num, { width: COLUMNS.az }]}>
        {sat.azimuth !== undefined ? `${sat.azimuth}°` : DASH}
      </AppText>
      <View style={styles.flags}>
        <AppText variant="mono" style={used ? styles.bold : undefined}>
          {`${sat.hasEphemeris ? 'E' : ' '}${sat.hasAlmanac ? 'A' : ' '}${used ? 'U' : ' '}`}
        </AppText>
        {sat.diffCorr ? <AppText variant="mono">D</AppText> : null}
        {unhealthy ? (
          <MaterialCommunityIcons name="alert" size={16} color={colors.warning} />
        ) : null}
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: ROW_HEIGHT,
    paddingHorizontal: spacing.lg,
    gap: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sv: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  num: {
    textAlign: 'right',
  },
  flags: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacing.xs,
  },
  bold: {
    fontWeight: '700',
  },
});
