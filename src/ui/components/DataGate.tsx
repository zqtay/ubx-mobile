import { router } from 'expo-router';
import type { ComponentProps, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import type MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

import { useGnssStore } from '@/state/gnssStore';
import { useAppTheme } from '@/ui/theme/ThemeProvider';
import { spacing } from '@/ui/theme/tokens';

import { AppText } from './AppText';
import { Banner } from './Banner';
import { EmptyState } from './EmptyState';

export interface DataGateProps {
  icon: ComponentProps<typeof MaterialCommunityIcons>['name'];
  /** What this screen will show once a source is active. */
  placeholder: string;
  children: ReactNode;
}

export function openReceiverSheet(): void {
  router.push('/source');
}

/**
 * Global data states shared by Status, Satellites, Sky and Device (functional spec §1.1):
 * no source → "Choose a GNSS receiver"; connecting/detecting with no data yet → spinner;
 * otherwise the screen, with a stale or error banner on top when applicable.
 */
export function DataGate({ icon, placeholder, children }: DataGateProps) {
  const { t } = useTranslation();
  const { colors } = useAppTheme();
  const source = useGnssStore((s) => s.source);
  const connection = useGnssStore((s) => s.connection);
  const hasData = useGnssStore(
    (s) => s.stats.bytes > 0 || s.satellites.length > 0 || s.fix !== undefined,
  );

  if (!source) {
    return (
      <View style={[styles.fill, { backgroundColor: colors.bg }]}>
        <EmptyState
          icon={icon}
          title={t('source.chooseTitle')}
          body={`${placeholder}\n${t('source.chooseBody')}`}
          actionLabel={t('source.chooseAction')}
          onAction={openReceiverSheet}
        />
      </View>
    );
  }

  if (!hasData && (connection.kind === 'connecting' || connection.kind === 'detecting')) {
    return (
      <View style={[styles.fill, styles.center, { backgroundColor: colors.bg }]}>
        <ActivityIndicator color={colors.primary} size="large" />
        <AppText muted>{t('dataState.waiting', { source: t(`source.kind.${source}`) })}</AppText>
      </View>
    );
  }

  return (
    <View style={[styles.fill, { backgroundColor: colors.bg }]}>
      {connection.kind === 'disconnected' ? (
        <View style={styles.banner}>
          <Banner tone="warning" message={t('dataState.stale')} />
        </View>
      ) : null}
      {connection.kind === 'error' ? (
        <View style={styles.banner}>
          <Banner
            tone="danger"
            message={connection.message}
            actionLabel={t('dataState.retry')}
            onAction={openReceiverSheet}
          />
        </View>
      ) : null}
      <View style={[styles.fill, connection.kind === 'disconnected' && styles.stale]}>
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  banner: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  stale: {
    opacity: 0.5,
  },
});
