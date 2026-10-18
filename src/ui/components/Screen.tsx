import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { useAppTheme } from '@/ui/theme/ThemeProvider';
import { spacing } from '@/ui/theme/tokens';

export interface ScreenProps {
  children: ReactNode;
  /** Scrollable content (default) or a fixed, full-height container. */
  scroll?: boolean;
}

/** Standard screen container: themed background, 16 dp gutters, card spacing. */
export function Screen({ children, scroll = true }: ScreenProps) {
  const { colors } = useAppTheme();
  if (!scroll) {
    return <View style={[styles.fill, { backgroundColor: colors.bg }]}>{children}</View>;
  }
  return (
    <ScrollView
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic">
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.md,
  },
});
