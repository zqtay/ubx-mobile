import { router, type Href } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { configAvailability } from '@/config/availability';
import { useGnssStore } from '@/state/gnssStore';
import { Card, ListItem, Screen } from '@/ui/components';
import { unavailableMessage } from '@/ui/config/labels';
import { useAppTheme } from '@/ui/theme/ThemeProvider';

// Typed-route generation lists the index file as /config/index; the URL is /config.
const CONFIG_ROUTE = '/config' as Href;

export default function MoreScreen() {
  const { t } = useTranslation();
  const { colors } = useAppTheme();
  const config = useGnssStore((s) => configAvailability(s));
  const divider = <View style={[styles.divider, { backgroundColor: colors.border }]} />;
  return (
    <Screen>
      <Card style={styles.card}>
        <ListItem
          icon="tune-vertical"
          title={t('more.config')}
          subtitle={config === 'ok' ? t('more.configHint') : unavailableMessage(t, config)}
          disabled={config !== 'ok'}
          onPress={() => router.push(CONFIG_ROUTE)}
        />
        {divider}
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
          icon="help-circle-outline"
          title={t('more.help')}
          subtitle={t('more.helpHint')}
          onPress={() => router.push('/help' as Href)}
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
