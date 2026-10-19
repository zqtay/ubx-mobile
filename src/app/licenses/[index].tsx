import { Stack, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Linking, Pressable } from 'react-native';

import { licenses, licenseTexts } from '@/legal';
import { AppText, Card, KeyValueRow, Screen } from '@/ui/components';
import { useAppTheme } from '@/ui/theme/ThemeProvider';

/** Licence of one open-source component. */
export default function LicenseScreen() {
  const { t } = useTranslation();
  const { colors } = useAppTheme();
  const { index } = useLocalSearchParams<{ index: string }>();
  const entry = licenses[Number(index)];
  if (!entry) return null;
  const text = entry.text !== undefined ? licenseTexts[entry.text] : undefined;
  return (
    <Screen stackPage>
      <Stack.Screen options={{ title: entry.name }} />
      <Card>
        <KeyValueRow label={t('licenses.version')} value={entry.version} mono />
        <KeyValueRow label={t('licenses.license')} value={entry.license} />
        {entry.note ? <AppText muted>{entry.note}</AppText> : null}
        {entry.repository ? (
          <Pressable
            accessibilityRole="link"
            onPress={() => void Linking.openURL(entry.repository!)}>
            <AppText color={colors.primary}>{entry.repository}</AppText>
          </Pressable>
        ) : null}
      </Card>
      <Card>
        <AppText variant="mono" style={{ fontSize: 12, lineHeight: 17 }} selectable>
          {text ?? t('licenses.noText', { license: entry.license })}
        </AppText>
      </Card>
    </Screen>
  );
}
