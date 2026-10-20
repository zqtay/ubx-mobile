import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';

import {
  backupItems,
  differentReceiver,
  findBackup,
  restorePlan,
  savedItems,
  type RestorePlan,
} from '@/config/backups';
import { keyName } from '@/config/keys';
import { settingByKey } from '@/config/sections';
import { useConfigStore } from '@/sources';
import { useGnssStore } from '@/state/gnssStore';
import { AppText, Banner, Button, Card, SegmentedControl } from '@/ui/components';
import { settingLabel, settingValue } from '@/ui/config/labels';
import { useBottomInset } from '@/ui/hooks/useBottomInset';
import { useAppTheme } from '@/ui/theme/ThemeProvider';
import { spacing } from '@/ui/theme/tokens';

type Source = 'ram' | 'saved';

/** Restore preview: differences from the receiver, then stage them (functional spec §11.6). */
export default function RestoreScreen() {
  const { t } = useTranslation();
  const { colors } = useAppTheme();
  const bottom = useBottomInset();
  const { id } = useLocalSearchParams<{ id: string }>();
  const backup = useMemo(() => (id ? findBackup(id) : undefined), [id]);
  const receiver = useGnssStore((s) => s.device.receiver);
  const port = useConfigStore((s) => s.port) ?? 'UART1';
  const saved = useMemo(() => (backup ? savedItems(backup) : undefined), [backup]);
  const [source, setSource] = useState<Source>('ram');
  const [plan, setPlan] = useState<{ source: Source; plan: RestorePlan } | undefined>();

  const items = useMemo(
    () => (backup ? (source === 'saved' && saved ? saved : backupItems(backup)) : []),
    [backup, source, saved],
  );

  useEffect(() => {
    if (items.length === 0) return;
    let cancelled = false;
    void useConfigStore
      .getState()
      .readCurrent(items.map((i) => i.key))
      .then((current) => {
        if (!cancelled && current) setPlan({ source, plan: restorePlan(items, current) });
      });
    return () => {
      cancelled = true;
    };
  }, [items, source]);

  if (!backup) {
    return (
      <View style={[styles.fill, styles.content, { backgroundColor: colors.bg }]}>
        <Banner tone="danger" message={t('config.restore.notFound')} />
      </View>
    );
  }

  const current = plan?.source === source ? plan.plan : undefined;
  const describe = (key: number, value: number) => {
    const s = settingByKey(port, key);
    return s ? settingValue(t, s, value) : String(value);
  };
  const stage = () => {
    if (!current) return;
    useConfigStore.getState().stageMany(current.changes.map((c) => ({ key: c.key, value: c.to })));
    router.dismissTo('/config' as Href);
  };

  return (
    <ScrollView
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={[styles.content, { paddingBottom: bottom }]}>
      {differentReceiver(backup, {
        module: receiver.module,
        fwVersion: receiver.fwVersion,
        protocolVersion: receiver.protocolVersion,
      }) ? (
        <Banner
          tone="warning"
          message={t('config.restore.differentReceiver', {
            module: [backup.receiver.module, backup.receiver.fwVersion].filter(Boolean).join(' '),
          })}
        />
      ) : null}
      {saved ? (
        <View style={styles.field}>
          <AppText variant="label" muted>
            {t('config.restore.layer')}
          </AppText>
          <SegmentedControl<Source>
            label={t('config.restore.layer')}
            value={source}
            onChange={setSource}
            options={[
              { value: 'ram', label: t('config.restore.layerRam') },
              { value: 'saved', label: t('config.restore.layerSaved') },
            ]}
          />
        </View>
      ) : null}

      {!current ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.primary} />
          <AppText muted>{t('config.restore.reading')}</AppText>
        </View>
      ) : (
        <>
          <AppText testID="restore-summary">
            {t('config.restore.summary', {
              changes: current.changes.length,
              unchanged: current.unchanged,
              unknown: current.unknown.length,
            })}
          </AppText>
          {current.changes.length > 0 ? (
            <Card title={t('config.restore.changes')}>
              {current.changes.map((c) => {
                const s = settingByKey(port, c.key);
                return (
                  <AppText key={c.key} variant="mono" style={styles.small}>
                    {t('config.change', {
                      name: s ? settingLabel(t, s) : keyName(c.key),
                      from: describe(c.key, c.from),
                      to: describe(c.key, c.to),
                    })}
                  </AppText>
                );
              })}
            </Card>
          ) : (
            <Banner tone="success" message={t('config.restore.nothing')} />
          )}
          {current.unknown.length > 0 ? (
            <Card title={t('config.restore.unknown')}>
              <AppText variant="mono" style={styles.small}>
                {current.unknown.map(keyName).join('\n')}
              </AppText>
            </Card>
          ) : null}
          <Button
            label={t('config.restore.stage', { count: current.changes.length })}
            disabled={current.changes.length === 0}
            onPress={stage}
          />
          <AppText variant="caption" muted>
            {t('config.restore.stageHint')}
          </AppText>
        </>
      )}
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
  field: {
    gap: spacing.xs,
  },
  loading: {
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.xl,
  },
  small: {
    fontSize: 12,
    lineHeight: 18,
  },
});
