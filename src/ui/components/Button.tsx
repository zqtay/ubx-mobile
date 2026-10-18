import { Pressable, StyleSheet } from 'react-native';

import { useAppTheme } from '@/ui/theme/ThemeProvider';
import { minTouchTarget, radius, spacing } from '@/ui/theme/tokens';

import { AppText } from './AppText';

export interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
}

export function Button({ label, onPress, variant = 'primary', disabled }: ButtonProps) {
  const { colors } = useAppTheme();
  const primary = variant === 'primary';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: primary ? colors.primary : 'transparent',
          borderColor: colors.primary,
          opacity: disabled ? 0.4 : pressed ? 0.75 : 1,
        },
      ]}>
      <AppText variant="label" color={primary ? colors.onPrimary : colors.primary}>
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: minTouchTarget,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
