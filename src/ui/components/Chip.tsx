import type { ReactNode } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { useAppTheme } from '@/ui/theme/ThemeProvider';
import { radius, spacing } from '@/ui/theme/tokens';

import { AppText } from './AppText';

export interface ChipProps {
  label: string;
  selected: boolean;
  onPress: () => void;
  /** Optional leading element, e.g. a constellation shape. */
  icon?: ReactNode;
  accessibilityLabel?: string;
  testID?: string;
}

/** Toggleable filter chip. Selection is shown by fill, border weight and a checked state. */
export function Chip({ label, selected, onPress, icon, accessibilityLabel, testID }: ChipProps) {
  const { colors } = useAppTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={onPress}
      hitSlop={{ top: 6, bottom: 6 }}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: selected ? colors.primary : colors.surface,
          borderColor: selected ? colors.primary : colors.border,
          opacity: pressed ? 0.75 : 1,
        },
      ]}>
      {icon}
      <AppText
        variant="label"
        numberOfLines={1}
        color={selected ? colors.onPrimary : colors.text}
        style={selected ? styles.selected : undefined}>
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: 36,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  selected: {
    fontWeight: '700',
  },
});
