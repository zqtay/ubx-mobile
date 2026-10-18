import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect } from 'react-native-svg';

import { CONSTELLATIONS } from '@/domain/constellations';
import { AppText } from '@/ui/components';
import { ShapeIcon } from '@/ui/components/ShapeIcon';
import { useAppTheme } from '@/ui/theme/ThemeProvider';
import { minTouchTarget, spacing } from '@/ui/theme/tokens';

import { cn0GradientStops } from './Cn0Gauge';

/** Collapsible sky legend (REQ-SKY-08): shapes, used/unused encoding and the C/N0 scale. */
export function Legend({ width }: { width: number }) {
  const { t } = useTranslation();
  const { colors, scheme } = useAppTheme();
  const [open, setOpen] = useState(true);
  const usedStroke = scheme === 'dark' ? '#FFFFFF' : '#111418';
  const shown = CONSTELLATIONS.filter((c) => c.id !== 'IMES' && c.id !== 'UNKNOWN');

  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(!open)}
        style={styles.header}>
        <AppText variant="heading">{t('sky.legend')}</AppText>
        <MaterialCommunityIcons
          name={open ? 'chevron-up' : 'chevron-down'}
          size={22}
          color={colors.textMuted}
        />
      </Pressable>
      {open ? (
        <View style={styles.body}>
          <AppText variant="label" muted>
            {t('sky.legendGnss')}
          </AppText>
          <View style={styles.grid}>
            {shown.map((c) => (
              <View key={c.id} style={styles.item}>
                <ShapeIcon shape={c.shape} fill={colors.textMuted} size={14} />
                <AppText variant="caption">{c.name}</AppText>
              </View>
            ))}
          </View>
          <View style={styles.grid}>
            <View style={styles.item}>
              <ShapeIcon
                shape="circle"
                fill={colors.gnss.gal}
                stroke={usedStroke}
                strokeWidth={2}
                size={16}
              />
              <AppText variant="caption">{t('sky.legendUsed')}</AppText>
            </View>
            <View style={[styles.item, styles.faded]}>
              <ShapeIcon
                shape="circle"
                fill={colors.gnss.gal}
                stroke={colors.grid}
                strokeWidth={1}
                size={16}
              />
              <AppText variant="caption">{t('sky.legendNotUsed')}</AppText>
            </View>
          </View>
          <AppText variant="label" muted>
            {t('sky.legendCn0')}
          </AppText>
          <Svg width={width} height={14}>
            <Defs>
              <LinearGradient id="legendCn0" x1="0" y1="0" x2="1" y2="0">
                {cn0GradientStops()}
              </LinearGradient>
            </Defs>
            <Rect x={0} y={0} width={width} height={14} rx={3} fill="url(#legendCn0)" />
          </Svg>
          <View style={styles.scale}>
            {['<10', '20', '27', '35', '≥45'].map((v) => (
              <AppText key={v} variant="caption" muted>
                {v}
              </AppText>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: minTouchTarget,
  },
  body: {
    gap: spacing.sm,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  faded: {
    opacity: 0.6,
  },
  scale: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
});
