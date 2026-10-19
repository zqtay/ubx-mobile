import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { useAppTheme } from '@/ui/theme/ThemeProvider';
import { minTouchTarget, spacing } from '@/ui/theme/tokens';

import { AppText } from './AppText';

export interface ListItemProps {
  icon: ComponentProps<typeof MaterialCommunityIcons>['name'];
  title: string;
  subtitle?: string;
  onPress: () => void;
  /** Greyed out and not pressable; the subtitle should say why. */
  disabled?: boolean;
  /** Small text before the chevron, e.g. an "unsaved" badge. */
  badge?: string;
}

/** Navigation row with icon, title, optional subtitle and chevron. */
export function ListItem({ icon, title, subtitle, onPress, disabled, badge }: ListItemProps) {
  const { colors } = useAppTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[title, subtitle, badge].filter(Boolean).join('. ')}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      android_ripple={{ color: colors.surfaceAlt }}
      style={[styles.row, disabled && styles.disabled]}>
      <MaterialCommunityIcons name={icon} size={24} color={colors.primary} />
      <View style={styles.text}>
        <AppText variant="label">{title}</AppText>
        {subtitle ? (
          <AppText variant="caption" muted>
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {badge ? (
        <AppText variant="caption" color={colors.warning}>
          {badge}
        </AppText>
      ) : null}
      <MaterialCommunityIcons name="chevron-right" size={20} color={colors.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    minHeight: minTouchTarget + spacing.md,
    paddingHorizontal: spacing.lg,
  },
  text: {
    flex: 1,
    gap: 2,
  },
  disabled: {
    opacity: 0.5,
  },
});
