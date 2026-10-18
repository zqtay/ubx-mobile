import { StyleSheet, View } from 'react-native';

import { AppText } from '@/ui/components';
import { DASH } from '@/ui/format';
import { cn0Color } from '@/ui/theme/cn0Scale';
import { useAppTheme } from '@/ui/theme/ThemeProvider';
import { radius } from '@/ui/theme/tokens';

const MAX_CN0 = 55;

/** Horizontal C/N0 bar with the numeric value next to it (functional spec §4.1, never colour alone). */
export function Cn0Bar({ cn0, width = 64 }: { cn0: number | undefined; width?: number }) {
  const { colors } = useAppTheme();
  const value = cn0 ?? 0;
  const fraction = Math.max(0, Math.min(1, value / MAX_CN0));
  return (
    <View style={styles.row}>
      <View style={[styles.track, { width, backgroundColor: colors.surfaceAlt }]}>
        {value > 0 ? (
          <View
            style={[styles.fill, { width: width * fraction, backgroundColor: cn0Color(value) }]}
          />
        ) : null}
      </View>
      <AppText variant="mono" style={styles.value}>
        {value > 0 ? Math.round(value) : DASH}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  track: {
    height: 10,
    borderRadius: radius.sm,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: radius.sm,
  },
  value: {
    width: 22,
    textAlign: 'right',
  },
});
