import { router, usePreventRemove, type Href } from 'expo-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';

import { availableSettings, SECTIONS } from '@/config/sections';
import type { RestartKind } from '@/config/valCodec';
import { useConfigStore } from '@/sources';
import { unsavedKeys } from '@/state/configStore';
import { useGnssStore } from '@/state/gnssStore';
import { AppText, Banner, Button, Card, ListItem } from '@/ui/components';
import {
  ConfigLoadState,
  ConfigOutcomeBanner,
  confirmSave,
  StagedBar,
  useConfigLoader,
} from '@/ui/config/ConfigParts';
import { sectionSummary, unavailableMessage } from '@/ui/config/labels';
import { useBottomInset } from '@/ui/hooks/useBottomInset';
import { useAppTheme } from '@/ui/theme/ThemeProvider';
import { spacing } from '@/ui/theme/tokens';

/** Configuration overview (functional spec §11.2): sections with summaries and actions. */
export default function ConfigOverviewScreen() {
  const { t } = useTranslation();
  const { colors } = useAppTheme();
  const availability = useConfigLoader();
  const receiver = useGnssStore((s) => s.device.receiver);
  const status = useConfigStore((s) => s.status);
  const port = useConfigStore((s) => s.port);
  const baud = useConfigStore((s) => s.baud);
  const ram = useConfigStore((s) => s.ram);
  const bbr = useConfigStore((s) => s.bbr);
  const flash = useConfigStore((s) => s.flash);
  const def = useConfigStore((s) => s.def);
  const staged = useConfigStore((s) => s.staged);
  const busy = useConfigStore((s) => s.busy);
  // The staged-changes bar handles the navigation bar inset when it is shown.
  const bottom = useBottomInset(staged.size > 0 || !!busy);
  const unsaved = useMemo(
    () => new Set(unsavedKeys({ ram, bbr, flash, def })),
    [ram, bbr, flash, def],
  );

  // Leaving with staged edits asks first (functional spec §11.3).
  usePreventRemove(staged.size > 0, ({ repeat }) => {
    Alert.alert(t('config.staged.leaveTitle', { count: staged.size }), undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('config.staged.discard'),
        style: 'destructive',
        onPress: () => {
          useConfigStore.getState().discard();
          repeat();
        },
      },
    ]);
  });

  const ready = status === 'ready' && port !== undefined;
  const divider = <View style={[styles.divider, { backgroundColor: colors.border }]} />;

  const restart = (kind: RestartKind) => void useConfigStore.getState().restart(kind);
  const revert = () =>
    Alert.alert(t('config.revert.confirmTitle', { count: unsaved.size }), undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('config.revert.confirm'),
        onPress: () => void useConfigStore.getState().revertToSaved(),
      },
    ]);
  const factoryReset = () =>
    Alert.alert(t('config.factory.confirmTitle'), t('config.factory.confirmMessage'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('config.factory.confirm'),
        style: 'destructive',
        onPress: () => void useConfigStore.getState().factoryReset(),
      },
    ]);

  return (
    <View style={[styles.fill, { backgroundColor: colors.bg }]}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: bottom }]}>
        {availability !== 'ok' ? (
          <Banner tone="info" message={unavailableMessage(t, availability)} />
        ) : null}
        {availability === 'ok' || ready ? <ConfigLoadState /> : null}
        <ConfigOutcomeBanner />
        {ready ? (
          <>
            <Card>
              <AppText variant="heading">
                {[receiver.module ?? 'u-blox', receiver.fwVersion].filter(Boolean).join(' · ')}
              </AppText>
              <AppText muted>
                {port === 'USB'
                  ? t('config.linkUsb')
                  : t('config.link', { port, baud: baud ?? '—' })}
              </AppText>
              <AppText variant="label" color={unsaved.size ? colors.warning : colors.textMuted}>
                {unsaved.size
                  ? t('config.unsavedCount', { count: unsaved.size })
                  : t('config.allSaved')}
              </AppText>
            </Card>

            <Card title={t('config.sections')} flush>
              {SECTIONS.filter((s) => availableSettings(s, port, ram).length > 0).map((s, i) => {
                const keys = availableSettings(s, port, ram).map((x) => x.key);
                const values = new Map([...ram, ...staged]);
                return (
                  <View key={s.id}>
                    {i > 0 ? divider : null}
                    <ListItem
                      icon={s.icon}
                      title={t(`config.section.${s.id}`)}
                      subtitle={sectionSummary(t, s, port, values)}
                      badge={
                        keys.some((k) => unsaved.has(k)) ? t('config.unsavedBadge') : undefined
                      }
                      onPress={() =>
                        router.push({ pathname: '/config/[section]', params: { section: s.id } })
                      }
                    />
                  </View>
                );
              })}
            </Card>

            <Card title={t('config.restart.title')}>
              <AppText variant="caption" muted>
                {t('config.restart.hint')}
              </AppText>
              <View style={styles.row}>
                {(['hot', 'warm', 'cold'] as const).map((kind) => (
                  <View key={kind} style={styles.flex}>
                    <Button
                      variant="secondary"
                      label={t(`config.restart.${kind}`)}
                      disabled={!!busy}
                      onPress={() => restart(kind)}
                    />
                  </View>
                ))}
              </View>
            </Card>

            <Card title={t('config.actions')} flush>
              <ListItem
                icon="content-save-outline"
                title={t('config.save.label')}
                subtitle={t('config.save.hint')}
                disabled={!!busy || unsaved.size === 0}
                onPress={() => confirmSave(t)}
              />
              {divider}
              <ListItem
                icon="undo-variant"
                title={t('config.revert.label')}
                subtitle={t('config.revert.hint')}
                disabled={!!busy || unsaved.size === 0}
                onPress={revert}
              />
              {divider}
              <ListItem
                icon="file-tree-outline"
                title={t('config.advanced.entry')}
                subtitle={t('config.advanced.entryHint')}
                disabled={!!busy}
                onPress={() => router.push('/config/advanced' as Href)}
              />
              {divider}
              <ListItem
                icon="backup-restore"
                title={t('config.backups.entry')}
                subtitle={t('config.backups.entryHint')}
                disabled={!!busy}
                onPress={() => router.push('/config/backups' as Href)}
              />
              {divider}
              <ListItem
                icon="alert-octagon-outline"
                title={t('config.factory.label')}
                subtitle={t('config.factory.hint')}
                disabled={!!busy}
                onPress={factoryReset}
              />
            </Card>
          </>
        ) : null}
      </ScrollView>
      <StagedBar />
    </View>
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
  divider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 56,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  flex: {
    flex: 1,
  },
});
