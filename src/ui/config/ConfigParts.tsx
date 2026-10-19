import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { configAvailability } from '@/config/availability';
import { keyName } from '@/config/keys';
import { settingByKey } from '@/config/sections';
import { useConfigStore } from '@/sources';
import { findings, storedValue, unsavedKeys } from '@/state/configStore';
import { useGnssStore } from '@/state/gnssStore';
import { AppText, Banner, Button } from '@/ui/components';
import { useAppTheme } from '@/ui/theme/ThemeProvider';
import { spacing } from '@/ui/theme/tokens';

import { outcomeMessage, ruleMessage, settingLabel, settingValue } from './labels';

/** Whether configuration is available, loading it once when it becomes available. */
export function useConfigLoader() {
  const availability = useGnssStore((s) => configAvailability(s));
  const status = useConfigStore((s) => s.status);
  useEffect(() => {
    if (availability === 'ok' && status === 'idle') void useConfigStore.getState().load();
  }, [availability, status]);
  return availability;
}

/** Loading spinner or read error with Retry; renders nothing when ready. */
export function ConfigLoadState() {
  const { t } = useTranslation();
  const status = useConfigStore((s) => s.status);
  const error = useConfigStore((s) => s.error);
  if (status === 'loading' || status === 'idle') {
    return (
      <View style={styles.loading}>
        <ActivityIndicator />
        <AppText muted>{t('config.loading')}</AppText>
      </View>
    );
  }
  if (status === 'error') {
    return (
      <Banner
        tone="danger"
        message={t(`config.error.${error ?? 'failed'}`)}
        actionLabel={t('common.retry')}
        onAction={() => void useConfigStore.getState().load()}
      />
    );
  }
  return null;
}

/** Result of the last action, with a Save shortcut after Apply (functional spec §11.3). */
export function ConfigOutcomeBanner() {
  const { t } = useTranslation();
  const outcome = useConfigStore((s) => s.lastOutcome);
  if (!outcome) return null;
  const { tone, message } = outcomeMessage(t, outcome);
  const offerSave = outcome.action === 'apply' && outcome.status === 'applied';
  return (
    <Banner
      tone={tone}
      message={message}
      actionLabel={offerSave ? t('config.save.confirm') : undefined}
      onAction={offerSave ? () => confirmSave(t) : undefined}
    />
  );
}

type T = ReturnType<typeof useTranslation>['t'];

function changeLines(
  t: T,
  items: { key: number; from: number | undefined; to: number | undefined }[],
) {
  const port = useConfigStore.getState().port ?? 'UART1';
  return items
    .map(({ key, from, to }) => {
      const s = settingByKey(port, key);
      return t('config.change', {
        name: s ? settingLabel(t, s) : keyName(key),
        from: s ? settingValue(t, s, from) : String(from),
        to: s ? settingValue(t, s, to) : String(to),
      });
    })
    .join('\n');
}

/** "Make these changes permanent?" listing saved → current (functional spec §11.6). */
export function confirmSave(t: T) {
  const s = useConfigStore.getState();
  const items = unsavedKeys(s).map((key) => ({
    key,
    from: storedValue(s, key),
    to: s.ram.get(key),
  }));
  if (items.length === 0) return;
  Alert.alert(t('config.save.confirmTitle'), changeLines(t, items), [
    { text: t('common.cancel'), style: 'cancel' },
    { text: t('config.save.confirm'), onPress: () => void useConfigStore.getState().save() },
  ]);
}

/**
 * Sticky bar for staged changes (functional spec §11.3): count, rule findings, Discard and
 * Apply. More than one change is confirmed with a summary first.
 */
export function StagedBar() {
  const { t } = useTranslation();
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  const staged = useConfigStore((s) => s.staged);
  const busy = useConfigStore((s) => s.busy);
  const ram = useConfigStore((s) => s.ram);
  const port = useConfigStore((s) => s.port);
  const baud = useConfigStore((s) => s.baud);
  const found = useMemo(() => findings({ ram, staged, port, baud }), [ram, staged, port, baud]);
  if (staged.size === 0 && !busy) return null;

  const blocked = found.some((f) => f.severity === 'error');
  const apply = () => {
    const s = useConfigStore.getState();
    if (s.staged.size === 1) {
      void s.apply();
      return;
    }
    const items = [...s.staged].map(([key, to]) => ({ key, from: s.ram.get(key), to }));
    Alert.alert(t('config.staged.confirmTitle', { count: items.length }), changeLines(t, items), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('config.staged.apply'), onPress: () => void useConfigStore.getState().apply() },
    ]);
  };

  return (
    <View
      testID="staged-bar"
      style={[
        styles.bar,
        {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          paddingBottom: spacing.md + insets.bottom,
        },
      ]}>
      {staged.size > 0
        ? found.map((f) => (
            <Banner
              key={f.id}
              tone={f.severity === 'error' ? 'danger' : 'warning'}
              message={ruleMessage(t, f)}
            />
          ))
        : null}
      <View style={styles.actions}>
        {busy ? <ActivityIndicator /> : null}
        <AppText variant="label" style={styles.count}>
          {busy ? t('config.staged.working') : t('config.staged.count', { count: staged.size })}
        </AppText>
        <Button
          variant="secondary"
          label={t('config.staged.discard')}
          disabled={!!busy}
          onPress={() => useConfigStore.getState().discard()}
        />
        <Button label={t('config.staged.apply')} disabled={!!busy || blocked} onPress={apply} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  loading: {
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.xl,
  },
  bar: {
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  count: {
    flex: 1,
  },
});
