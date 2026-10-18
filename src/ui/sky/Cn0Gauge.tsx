import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import Svg, {
  Defs,
  LinearGradient,
  Line,
  Path,
  Rect,
  Stop,
  Text as SvgText,
} from 'react-native-svg';

import type { AverageCn0 } from '@/state/selectors';
import { AppText } from '@/ui/components';
import { useAppTheme } from '@/ui/theme/ThemeProvider';
import { cn0NoSignal, cn0Stops, spacing } from '@/ui/theme/tokens';

const MIN = 10;
const MAX = 45;
const TICKS = [10, 18, 27, 36, 45];

/** Gradient stops for 10–45 dB-Hz, shared with the legend (LinearGradient needs an array). */
export function cn0GradientStops() {
  return [
    <Stop key="none" offset="0" stopColor={cn0NoSignal} />,
    ...cn0Stops.map((s) => (
      <Stop
        key={s.cn0}
        offset={String((Math.max(MIN, s.cn0) - MIN) / (MAX - MIN))}
        stopColor={s.color}
      />
    )),
  ];
}

/**
 * Average C/N0 gauge (REQ-SKY-07): colour bar from 10 to 45 dB-Hz with pointers for satellites
 * in view (hollow) and used in fix (filled). Out-of-range values clamp to the ends but keep
 * their true value in the label.
 */
export function Cn0Gauge({ average, width }: { average: AverageCn0; width: number }) {
  const { t } = useTranslation();
  const { colors } = useAppTheme();
  const barX = 8;
  const barW = width - 16;
  const barY = 30;
  const barH = 14;
  const xOf = (v: number) => barX + (Math.max(MIN, Math.min(MAX, v)) - MIN) * (barW / (MAX - MIN));

  const pointer = (value: number | undefined, filled: boolean, labelAbove: boolean) => {
    if (value === undefined) return null;
    const x = xOf(value);
    const tipY = barY - 1;
    return (
      <>
        <Path
          d={`M${x - 6},${tipY - 9}L${x + 6},${tipY - 9}L${x},${tipY}Z`}
          fill={filled ? colors.text : colors.surface}
          stroke={colors.text}
          strokeWidth={1.5}
        />
        <SvgText
          x={x}
          y={labelAbove ? tipY - 12 : barY + barH + 26}
          fontSize={11}
          fontWeight="700"
          textAnchor="middle"
          fill={colors.text}>
          {value.toFixed(1)}
        </SvgText>
      </>
    );
  };

  return (
    <View
      testID="cn0-gauge"
      accessible
      accessibilityLabel={`${t('sky.avgCn0')}: ${t('sky.inView')} ${average.inView?.toFixed(1) ?? '—'}, ${t('sky.used')} ${average.used?.toFixed(1) ?? '—'} ${t('sky.dbHz')}`}>
      <View style={styles.header}>
        <AppText variant="label">{t('sky.avgCn0')}</AppText>
        <AppText variant="caption" muted>
          {`▽ ${t('sky.inView')} ${average.inView?.toFixed(1) ?? '—'}   ▼ ${t('sky.used')} ${average.used?.toFixed(1) ?? '—'}  (${t('sky.dbHz')})`}
        </AppText>
      </View>
      <Svg width={width} height={barY + barH + 30}>
        <Defs>
          <LinearGradient id="cn0" x1="0" y1="0" x2="1" y2="0">
            {cn0GradientStops()}
          </LinearGradient>
        </Defs>
        <Rect
          x={barX}
          y={barY}
          width={barW}
          height={barH}
          rx={3}
          fill="url(#cn0)"
          stroke={colors.border}
        />
        {TICKS.map((v) => (
          <Line
            key={v}
            x1={xOf(v)}
            x2={xOf(v)}
            y1={barY + barH}
            y2={barY + barH + 5}
            stroke={colors.textMuted}
          />
        ))}
        {TICKS.map((v) => (
          <SvgText
            key={`l${v}`}
            x={xOf(v)}
            y={barY + barH + 15}
            fontSize={10}
            textAnchor="middle"
            fill={colors.textMuted}>
            {String(v)}
          </SvgText>
        ))}
        {pointer(average.inView, false, true)}
        {pointer(average.used, true, false)}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    gap: 2,
    marginBottom: spacing.xs,
  },
});
