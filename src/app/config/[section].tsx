import { Stack, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';

import { availableSettings, sectionById } from '@/config/sections';
import { useConfigStore } from '@/sources';
import { unsavedKeys } from '@/state/configStore';
import { AppText, Banner, Card } from '@/ui/components';
import {
  ConfigLoadState,
  ConfigOutcomeBanner,
  StagedBar,
  useConfigLoader,
} from '@/ui/config/ConfigParts';
import { unavailableMessage } from '@/ui/config/labels';
import { SettingRow } from '@/ui/config/SettingRow';
import { useAppTheme } from '@/ui/theme/ThemeProvider';
import { spacing } from '@/ui/theme/tokens';

/** One configuration section (functional spec §11.3, §11.4). */
export default function ConfigSectionScreen() {
  const { t } = useTranslation();
  const { colors } = useAppTheme();
  const { section: id } = useLocalSearchParams<{ section: string }>();
  const section = sectionById(id ?? '');
  const availability = useConfigLoader();
  const status = useConfigStore((s) => s.status);
  const port = useConfigStore((s) => s.port);
  const ram = useConfigStore((s) => s.ram);
  const bbr = useConfigStore((s) => s.bbr);
  const flash = useConfigStore((s) => s.flash);
  const def = useConfigStore((s) => s.def);
  const staged = useConfigStore((s) => s.staged);
  const busy = useConfigStore((s) => s.busy);
  const stage = useConfigStore((s) => s.stage);
  const unsaved = useMemo(
    () => new Set(unsavedKeys({ ram, bbr, flash, def })),
    [ram, bbr, flash, def],
  );

  const ready = status === 'ready' && port !== undefined;
  const effective = useMemo(() => new Map([...ram, ...staged]), [ram, staged]);
  const settings = section && port ? availableSettings(section, port, ram, effective) : [];
  const note =
    section?.id === 'gnss'
      ? t('config.note.gnss')
      : section?.id === 'messages'
        ? t('config.note.messages')
        : undefined;

  return (
    <View style={[styles.fill, { backgroundColor: colors.bg }]}>
      <Stack.Screen
        options={{ title: section ? t(`config.section.${section.id}`) : t('config.title') }}
      />
      <ScrollView contentContainerStyle={styles.content}>
        {availability !== 'ok' ? (
          <Banner tone="info" message={unavailableMessage(t, availability)} />
        ) : null}
        {availability === 'ok' || ready ? <ConfigLoadState /> : null}
        <ConfigOutcomeBanner />
        {ready && section ? (
          <Card>
            {note ? (
              <AppText variant="caption" muted>
                {note}
              </AppText>
            ) : null}
            {settings.length === 0 ? <AppText muted>{t('config.note.empty')}</AppText> : null}
            {settings.map((s) => (
              <SettingRow
                key={s.key}
                setting={s}
                current={ram.get(s.key)}
                staged={staged.get(s.key)}
                unsaved={unsaved.has(s.key)}
                disabled={!!busy}
                onChange={(value) => stage(s.key, value)}
              />
            ))}
          </Card>
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
});
