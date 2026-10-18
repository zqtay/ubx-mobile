import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Pressable, StyleSheet, View } from 'react-native';

import { useAppTheme } from '@/ui/theme/ThemeProvider';
import { minTouchTarget, radius, spacing } from '@/ui/theme/tokens';

import { AppText } from './AppText';

export type BannerTone = 'info' | 'success' | 'warning' | 'danger';

export interface BannerProps {
  tone: BannerTone;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

const icons = {
  info: 'information-outline',
  success: 'check-circle-outline',
  warning: 'alert-outline',
  danger: 'alert-circle-outline',
} as const;

/** Inline status/error banner (functional spec §1.1). Tone is conveyed by icon as well as colour. */
export function Banner({ tone, message, actionLabel, onAction }: BannerProps) {
  const { colors } = useAppTheme();
  const fg = colors[tone];
  const bg = colors[`${tone}Bg`];
  return (
    <View
      accessibilityRole="alert"
      style={[styles.banner, { backgroundColor: bg, borderColor: fg }]}>
      <MaterialCommunityIcons name={icons[tone]} size={20} color={fg} />
      <AppText variant="label" style={styles.message}>
        {message}
      </AppText>
      {actionLabel && onAction ? (
        <Pressable accessibilityRole="button" onPress={onAction} hitSlop={8} style={styles.action}>
          <AppText variant="label" color={fg} style={styles.actionText}>
            {actionLabel}
          </AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    borderLeftWidth: 4,
  },
  message: {
    flex: 1,
  },
  action: {
    minHeight: minTouchTarget,
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
  },
  actionText: {
    fontWeight: '700',
  },
});
