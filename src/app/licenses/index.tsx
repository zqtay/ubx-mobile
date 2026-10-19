import { router, type Href } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { licenses } from '@/legal';
import { AppText, Card, Screen } from '@/ui/components';
import { OSM_COPYRIGHT_URL } from '@/ui/map/tiles';
import { useAppTheme } from '@/ui/theme/ThemeProvider';
import { spacing } from '@/ui/theme/tokens';

/** Open-source licence notices (M7.4). */
export default function LicensesScreen() {
  const { t } = useTranslation();
  const { colors } = useAppTheme();
  return (
    <Screen stackPage>
      <Card title={t('licenses.mapData')}>
        <AppText muted>{t('licenses.mapDataText')}</AppText>
        <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(OSM_COPYRIGHT_URL)}>
          <AppText color={colors.primary}>{OSM_COPYRIGHT_URL}</AppText>
        </Pressable>
      </Card>
      <AppText variant="caption" muted>
        {t('licenses.intro', { count: licenses.length })}
      </AppText>
      <Card flush>
        {licenses.map((l, i) => (
          <View key={`${l.name}-${i}`}>
            {i > 0 ? <View style={[styles.divider, { backgroundColor: colors.border }]} /> : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${l.name} ${l.version ?? ''}, ${l.license}`}
              onPress={() =>
                router.push({
                  pathname: '/licenses/[index]',
                  params: { index: i },
                } as unknown as Href)
              }
              android_ripple={{ color: colors.surfaceAlt }}
              style={styles.row}>
              <View style={styles.flex}>
                <AppText variant="label">{l.name}</AppText>
                <AppText variant="caption" muted>
                  {[l.version, l.native ? t('licenses.native') : undefined]
                    .filter(Boolean)
                    .join(' · ')}
                </AppText>
              </View>
              <AppText variant="caption" muted>
                {l.license}
              </AppText>
            </Pressable>
          </View>
        ))}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 52,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
  },
  flex: {
    flex: 1,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: spacing.lg,
  },
});
