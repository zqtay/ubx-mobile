import { Pressable, StyleSheet, View } from 'react-native';

import { useAppTheme } from '@/ui/theme/ThemeProvider';
import { minTouchTarget, radius, spacing } from '@/ui/theme/tokens';

import { AppText } from './AppText';

export interface SegmentOption<T extends string | number> {
  value: T;
  label: string;
}

export interface SegmentedControlProps<T extends string | number> {
  /** Accessible name of the whole group. */
  label: string;
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
}

export function SegmentedControl<T extends string | number>({
  label,
  options,
  value,
  onChange,
}: SegmentedControlProps<T>) {
  const { colors } = useAppTheme();
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      style={[styles.group, { backgroundColor: colors.surfaceAlt }]}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={String(option.value)}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected }}
            onPress={() => onChange(option.value)}
            style={[
              styles.segment,
              selected && { backgroundColor: colors.surface, borderColor: colors.primary },
            ]}>
            <AppText
              variant="label"
              numberOfLines={1}
              color={selected ? colors.primary : colors.textMuted}
              style={selected && styles.selectedText}>
              {option.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  group: {
    flexDirection: 'row',
    borderRadius: radius.md,
    padding: spacing.xs,
    gap: spacing.xs,
  },
  segment: {
    flex: 1,
    minHeight: minTouchTarget - spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: 'transparent',
    paddingHorizontal: spacing.sm,
  },
  selectedText: {
    fontWeight: '700',
  },
});
