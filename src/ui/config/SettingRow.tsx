import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Switch, View } from 'react-native';

import type { SettingDef } from '@/config/sections';
import { AppText, Chip } from '@/ui/components';
import { useAppTheme } from '@/ui/theme/ThemeProvider';
import { minTouchTarget, radius, spacing } from '@/ui/theme/tokens';

import { settingLabel, settingValue, tr } from './labels';

export interface SettingRowProps {
  setting: SettingDef;
  /** Value in the receiver's RAM. */
  current: number | undefined;
  /** Staged value, if the user changed it. */
  staged: number | undefined;
  /** Current value differs from the saved one. */
  unsaved: boolean;
  disabled?: boolean;
  onChange: (value: number) => void;
}

/**
 * One configuration setting (functional spec §11.3): label, control, staged change shown as
 * ~~old~~ → new with an accent bar, and an "unsaved" badge.
 */
export function SettingRow({
  setting,
  current,
  staged,
  unsaved,
  disabled,
  onChange,
}: SettingRowProps) {
  const { t } = useTranslation();
  const { colors } = useAppTheme();
  const label = settingLabel(t, setting);
  const value = staged ?? current;
  const isStaged = staged !== undefined;
  const locked = setting.locked !== undefined;
  const c = setting.control;

  return (
    <View
      testID={`setting-${setting.key}`}
      style={[
        styles.row,
        setting.indent && styles.indent,
        { borderLeftColor: isStaged ? colors.primary : 'transparent' },
      ]}>
      <View style={styles.header}>
        <AppText variant="label" style={styles.label}>
          {label}
        </AppText>
        {unsaved && !isStaged ? (
          <AppText variant="caption" color={colors.warning}>
            {t('config.unsavedBadge')}
          </AppText>
        ) : null}
        {c.kind === 'switch' ? (
          <Switch
            accessibilityLabel={label}
            value={!!value}
            disabled={disabled || locked}
            onValueChange={(on) => onChange(on ? 1 : 0)}
            trackColor={{ true: colors.primary, false: colors.border }}
          />
        ) : null}
      </View>

      {c.kind === 'choice' ? (
        <View style={styles.chips}>
          {[
            ...c.options,
            // A value outside the presets (e.g. set by u-center) is still shown.
            ...(value !== undefined && !c.options.some((o) => o.value === value)
              ? [{ value, label: String(value) }]
              : []),
          ].map((o) => (
            <Chip
              key={o.value}
              label={o.label}
              selected={o.value === value}
              accessibilityLabel={`${label}: ${o.label}`}
              onPress={() => !disabled && onChange(o.value)}
            />
          ))}
        </View>
      ) : null}

      {c.kind === 'stepper' ? (
        <View style={styles.stepper}>
          <StepButton
            icon="minus"
            label={t('config.decrease', { name: label })}
            disabled={disabled || value === undefined || value <= c.min}
            onPress={() => onChange(Math.max(c.min, (value ?? c.min) - (c.step ?? 1)))}
          />
          <AppText
            variant="heading"
            style={styles.stepValue}
            accessibilityLabel={`${label}: ${value ?? ''}`}>
            {settingValue(t, setting, value)}
          </AppText>
          <StepButton
            icon="plus"
            label={t('config.increase', { name: label })}
            disabled={disabled || value === undefined || value >= c.max}
            onPress={() => onChange(Math.min(c.max, (value ?? c.min) + (c.step ?? 1)))}
          />
          <AppText variant="caption" muted style={styles.flex}>
            {c.unit ? (c.unit.startsWith('config.') ? tr(t, c.unit) : c.unit) : `${c.min}–${c.max}`}
          </AppText>
        </View>
      ) : null}

      {isStaged ? (
        <View style={styles.change}>
          <AppText variant="caption" muted style={styles.struck}>
            {settingValue(t, setting, current)}
          </AppText>
          <AppText variant="caption" color={colors.primary} style={styles.bold}>
            {`→ ${settingValue(t, setting, staged)}`}
          </AppText>
        </View>
      ) : null}
      {locked ? (
        <AppText variant="caption" muted>
          {tr(t, setting.locked!)}
        </AppText>
      ) : setting.help ? (
        <AppText variant="caption" muted>
          {tr(t, setting.help)}
        </AppText>
      ) : null}
    </View>
  );
}

function StepButton({
  icon,
  label,
  disabled,
  onPress,
}: {
  icon: 'minus' | 'plus';
  label: string;
  disabled: boolean;
  onPress: () => void;
}) {
  const { colors } = useAppTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.stepButton,
        { borderColor: colors.border, opacity: disabled ? 0.4 : pressed ? 0.7 : 1 },
      ]}>
      <MaterialCommunityIcons name={icon} size={20} color={colors.primary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingLeft: spacing.sm,
    borderLeftWidth: 3,
  },
  indent: {
    marginLeft: spacing.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 32,
  },
  label: {
    flex: 1,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  stepButton: {
    width: minTouchTarget,
    height: minTouchTarget,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepValue: {
    minWidth: 40,
    textAlign: 'center',
  },
  flex: {
    flex: 1,
  },
  change: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  struck: {
    textDecorationLine: 'line-through',
  },
  bold: {
    fontWeight: '700',
  },
});
