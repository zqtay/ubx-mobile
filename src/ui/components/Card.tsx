import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useAppTheme } from '@/ui/theme/ThemeProvider';
import { radius, spacing } from '@/ui/theme/tokens';

import { AppText } from './AppText';

export interface CardProps {
  title?: string;
  /** Optional element on the right of the title row (e.g. a copy button). */
  action?: ReactNode;
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
}

export function Card({ title, action, children, style }: CardProps) {
  const { colors } = useAppTheme();
  return (
    <View
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }, style]}>
      {(title || action) && (
        <View style={styles.header}>
          {title ? (
            <AppText variant="heading" accessibilityRole="header" style={styles.title}>
              {title}
            </AppText>
          ) : null}
          {action}
        </View>
      )}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  title: {
    flexShrink: 1,
  },
});
