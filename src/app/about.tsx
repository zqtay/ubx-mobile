import Constants from 'expo-constants';
import { router, type Href } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Share, StyleSheet, View } from 'react-native';

import { diagnosticsReport, useDiagnostics } from '@/state/diagnostics';
import { AppText, Button, Card, KeyValueRow, ListItem, Screen } from '@/ui/components';
import { spacing } from '@/ui/theme/tokens';

export default function AboutScreen() {
  const { t } = useTranslation();
  const config = Constants.expoConfig;
  const entries = useDiagnostics((s) => s.entries);
  const clear = useDiagnostics((s) => s.clear);

  // Shareable diagnostics log (REQ-LOG-03).
  const share = () =>
    void Share.share({
      title: t('about.diagnosticsTitle'),
      message: diagnosticsReport(
        entries,
        `${t('app.name')} ${config?.version ?? ''} (${config?.android?.versionCode ?? ''})`,
      ),
    });

  return (
    <Screen stackPage>
      <Card title={t('app.name')}>
        <AppText muted>{t('about.description')}</AppText>
        <KeyValueRow label={t('about.version')} value={config?.version} mono />
        <KeyValueRow label={t('about.build')} value={config?.android?.versionCode} mono />
      </Card>
      <Card title={t('about.diagnostics')}>
        <AppText muted>{t('about.diagnosticsHint', { count: entries.length })}</AppText>
        <View style={styles.buttons}>
          <Button label={t('about.shareDiagnostics')} onPress={share} />
          <Button
            variant="secondary"
            label={t('about.clearDiagnostics')}
            disabled={entries.length === 0}
            onPress={clear}
          />
        </View>
      </Card>
      <Card title={t('about.privacy')}>
        <AppText muted>{t('about.mapPrivacy')}</AppText>
      </Card>
      <Card flush>
        <ListItem
          icon="license"
          title={t('about.licenses')}
          subtitle={t('about.licensesHint')}
          onPress={() => router.push('/licenses' as Href)}
        />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  buttons: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
});
