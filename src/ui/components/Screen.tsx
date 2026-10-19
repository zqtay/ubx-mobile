import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAppTheme } from '@/ui/theme/ThemeProvider';
import { spacing } from '@/ui/theme/tokens';

export interface ScreenProps {
  children: ReactNode;
  /** Scrollable content (default) or a fixed, full-height container. */
  scroll?: boolean;
  /**
   * Full-screen (stack) page: pad the end of the content for the system navigation bar
   * (edge-to-edge). Not needed in tabs, where the tab bar handles it.
   */
  stackPage?: boolean;
}

/** Standard screen container: themed background, 16 dp gutters, card spacing. */
export function Screen({ children, scroll = true, stackPage = false }: ScreenProps) {
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  if (!scroll) {
    return <View style={[styles.fill, { backgroundColor: colors.bg }]}>{children}</View>;
  }
  return (
    <ScrollView
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={[
        styles.content,
        stackPage && { paddingBottom: spacing.lg + insets.bottom },
      ]}
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
