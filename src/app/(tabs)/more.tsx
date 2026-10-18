import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { Card, ListItem, Screen } from '@/ui/components';
import { useAppTheme } from '@/ui/theme/ThemeProvider';

export default function MoreScreen() {
  const { t } = useTranslation();
  const { colors } = useAppTheme();
  const divider = <View style={[styles.divider, { backgroundColor: colors.border }]} />;
  return (
    <Screen>
      <Card style={styles.card}>
        <ListItem
          icon="console-line"
          title={t('more.console')}
          subtitle={t('more.consoleHint')}
          onPress={() => router.push('/console')}
        />
        {divider}
        <ListItem
          icon="cog"
          title={t('more.settings')}
          subtitle={t('more.settingsHint')}
          onPress={() => router.push('/settings')}
        />
        {divider}
        <ListItem
          icon="information-outline"
          title={t('more.about')}
          subtitle={t('more.aboutHint')}
          onPress={() => router.push('/about')}
        />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 0,
    gap: 0,
    overflow: 'hidden',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 56,
  },
});
