import Constants from 'expo-constants';
import { useTranslation } from 'react-i18next';

import { AppText, Card, KeyValueRow, Screen } from '@/ui/components';

export default function AboutScreen() {
  const { t } = useTranslation();
  const config = Constants.expoConfig;
  return (
    <Screen>
      <Card title={t('app.name')}>
        <AppText muted>{t('about.description')}</AppText>
        <KeyValueRow label={t('about.version')} value={config?.version} mono />
        <KeyValueRow label={t('about.build')} value={config?.android?.versionCode} mono />
      </Card>
    </Screen>
  );
}
