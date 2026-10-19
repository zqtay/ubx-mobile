import * as Clipboard from 'expo-clipboard';
import { router, type Href } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, Share, StyleSheet, View } from 'react-native';

import {
  backupId,
  listBackups,
  parseBackup,
  storeBackup,
  type ConfigBackup,
} from '@/config/backups';
import { useConfigStore } from '@/sources';
import { AppText, Banner, Button, Card } from '@/ui/components';
import { ConfigOutcomeBanner, useConfigLoader } from '@/ui/config/ConfigParts';
import { unavailableMessage } from '@/ui/config/labels';
import { formatClock } from '@/ui/format';
import { useAppTheme } from '@/ui/theme/ThemeProvider';
import { spacing } from '@/ui/theme/tokens';

const restoreRoute = (b: ConfigBackup) =>
  ({ pathname: '/config/restore', params: { id: backupId(b) } }) as unknown as Href;

/** Backup list, new backup, share and paste (REQ-CFG-16, functional spec §11.6). */
export default function BackupsScreen() {
  const { t } = useTranslation();
  const { colors } = useAppTheme();
  const availability = useConfigLoader();
  const busy = useConfigStore((s) => s.busy);
  const [backups, setBackups] = useState(() => listBackups().reverse());
  const [pasteError, setPasteError] = useState(false);
  const refresh = () => setBackups(listBackups().reverse());

  const create = async () => {
    await useConfigStore.getState().backup();
    refresh();
  };
  const paste = async () => {
    try {
      const backup = parseBackup(await Clipboard.getStringAsync());
      storeBackup(backup);
      setPasteError(false);
      refresh();
      router.push(restoreRoute(backup));
    } catch {
      setPasteError(true);
    }
  };
  const share = (b: ConfigBackup) =>
    void Share.share({
      title: t('config.backups.shareTitle'),
      message: JSON.stringify(b, null, 2),
    });

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={styles.content}>
      {availability !== 'ok' ? (
        <Banner tone="info" message={unavailableMessage(t, availability)} />
      ) : null}
      <ConfigOutcomeBanner />
      {pasteError ? <Banner tone="danger" message={t('config.backups.pasteFailed')} /> : null}
      <View style={styles.buttons}>
        <Button
          label={busy === 'backup' ? t('config.staged.working') : t('config.backups.create')}
          disabled={availability !== 'ok' || !!busy}
          onPress={() => void create()}
        />
        <Button
          variant="secondary"
          label={t('config.backups.paste')}
          onPress={() => void paste()}
        />
      </View>
      <AppText variant="caption" muted>
        {t('config.backups.hint')}
      </AppText>
      {backups.length === 0 ? <AppText muted>{t('config.backups.empty')}</AppText> : null}
      {backups.map((b) => (
        <Card key={backupId(b)}>
          <AppText variant="label">
            {`${t(`config.backups.kind.${b.kind}`)} · ${new Date(b.createdAt).toLocaleDateString()} ${formatClock(Date.parse(b.createdAt))}`}
          </AppText>
          <AppText variant="caption" muted>
            {[
              b.receiver.module,
              b.receiver.fwVersion,
              t('config.backups.keys', { count: b.layers.ram.length }),
            ]
              .filter(Boolean)
              .join(' · ')}
          </AppText>
          <View style={styles.buttons}>
            <Button
              variant="secondary"
              label={t('config.backups.share')}
              onPress={() => share(b)}
            />
            <Button
              variant="secondary"
              label={t('config.backups.restore')}
              disabled={availability !== 'ok'}
              onPress={() => router.push(restoreRoute(b))}
            />
          </View>
        </Card>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  buttons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
});
