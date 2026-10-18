import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useAppTheme } from '@/ui/theme/ThemeProvider';
import { radius, spacing } from '@/ui/theme/tokens';

import { AppText } from './AppText';

export type ChipSource = 'none' | 'phone' | 'usb' | 'replay';
export type ChipTone = 'idle' | 'ok' | 'warn' | 'error';

export interface StatusChipProps {
  source: ChipSource;
  /** Short state text, e.g. "3D Fix" or "Disconnected". */
  label: string;
  tone: ChipTone;
  onPress?: () => void;
}

const sourceIcons = {
  none: 'help-circle-outline',
  phone: 'cellphone',
  usb: 'usb',
  replay: 'play-circle-outline',
} as const;

/**
 * Header chip showing the active source and its state (REQ-SRC-03).
 * The state dot is paired with text, so it never relies on colour alone.
 */
export function StatusChip({ source, label, tone, onPress }: StatusChipProps) {
  const { t } = useTranslation();
  const { colors } = useAppTheme();
  const dot = {
    idle: colors.textMuted,
    ok: colors.success,
    warn: colors.warning,
    error: colors.danger,
  }[tone];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('source.chipA11y', { label })}
      onPress={onPress}
      hitSlop={{ top: 8, bottom: 8 }}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: colors.surfaceAlt,
          borderColor: colors.border,
          opacity: pressed ? 0.7 : 1,
        },
      ]}>
      <View style={[styles.dot, { backgroundColor: dot }]} />
      <MaterialCommunityIcons name={sourceIcons[source]} size={16} color={colors.text} />
      <AppText variant="caption" numberOfLines={1} style={styles.label}>
        {label}
      </AppText>
      <MaterialCommunityIcons name="chevron-down" size={16} color={colors.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    minHeight: 32,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    marginRight: spacing.md,
    maxWidth: 200,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  label: {
    flexShrink: 1,
    fontWeight: '600',
  },
});
