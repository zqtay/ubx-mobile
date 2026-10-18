import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { ComponentProps } from 'react';
import { StyleSheet, View } from 'react-native';

import { useAppTheme } from '@/ui/theme/ThemeProvider';
import { spacing } from '@/ui/theme/tokens';

import { AppText } from './AppText';
import { Button } from './Button';

export interface EmptyStateProps {
  icon?: ComponentProps<typeof MaterialCommunityIcons>['name'];
  title: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({ icon, title, body, actionLabel, onAction }: EmptyStateProps) {
  const { colors } = useAppTheme();
  return (
    <View style={styles.container}>
      {icon ? (
        <MaterialCommunityIcons
          name={icon}
          size={56}
          color={colors.textMuted}
          accessibilityElementsHidden
          importantForAccessibility="no"
        />
      ) : null}
      <AppText variant="title" style={styles.center} accessibilityRole="header">
        {title}
      </AppText>
      {body ? (
        <AppText muted style={styles.center}>
          {body}
        </AppText>
      ) : null}
      {actionLabel && onAction ? <Button label={actionLabel} onPress={onAction} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.xl,
  },
  center: {
    textAlign: 'center',
    maxWidth: 360,
  },
});
