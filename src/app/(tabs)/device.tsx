import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, Share, StyleSheet, View } from 'react-native';

import { useGnssStore } from '@/state/gnssStore';
import { AppText, Button, Card, DataGate, KeyValueRow } from '@/ui/components';
import { deviceReportText, deviceSections } from '@/ui/deviceSections';
import { formatClock } from '@/ui/format';
import { useAppTheme } from '@/ui/theme/ThemeProvider';
import { spacing } from '@/ui/theme/tokens';

export default function DeviceScreen() {
  const { t } = useTranslation();
  return (
    <DataGate icon="chip" placeholder={t('screens.device.placeholder')}>
      <DeviceContent />
    </DataGate>
  );
}

/** Identity and capabilities of the active source (REQ-DEV-01..08). */
function DeviceContent() {
  const { t } = useTranslation();
  const { colors } = useAppTheme();
  const snapshot = useGnssStore((s) => s);
  const sections = useMemo(() => deviceSections(t, snapshot), [t, snapshot]);
  const info = snapshot.device.receiver.infoMessages;

  const share = () =>
    void Share.share({ message: deviceReportText(t('app.name'), sections, Date.now()) });

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Button variant="secondary" label={t('device.share')} onPress={share} />
      {sections.map((section) => (
        <Card key={section.title} title={section.title}>
          {section.hint ? (
            <AppText variant="caption" muted>
              {section.hint}
            </AppText>
          ) : null}
          {section.rows.map((row) => (
            <KeyValueRow key={row.label} label={row.label} value={row.value} mono={row.mono} />
          ))}
        </Card>
      ))}

      {info && info.length > 0 ? (
        <Card title={t('device.info')}>
          {[...info]
            .reverse()
            .slice(0, 20)
            .map((m, i) => (
              <View key={`${m.atMs}-${i}`} style={styles.info}>
                <AppText variant="caption" muted>
                  {`${formatClock(m.atMs)} · ${m.origin}`}
                </AppText>
                <AppText
                  variant="mono"
                  color={
                    m.level === 'error'
                      ? colors.danger
                      : m.level === 'warning'
                        ? colors.warning
                        : undefined
                  }>
                  {m.text}
                </AppText>
              </View>
            ))}
        </Card>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  info: {
    gap: 2,
  },
});
