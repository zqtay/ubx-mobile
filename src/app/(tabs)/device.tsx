import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useShallow } from 'zustand/react/shallow';

import { constellationMeta } from '@/domain/constellations';
import type { Constellation } from '@/domain/types';
import { useGnssStore } from '@/state/gnssStore';
import { AppText, Card, DataGate, KeyValueRow } from '@/ui/components';
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

const names = (list: Constellation[] | undefined) =>
  list?.map((c) => constellationMeta(c).name).join(', ');

/**
 * Receiver identity learned from the data stream (REQ-DEV-04..06, REQ-DEV-08). Transport details
 * (Android phone info, USB descriptor) are added with their sources in M3/M4.
 */
function DeviceContent() {
  const { t } = useTranslation();
  const { colors } = useAppTheme();
  const { receiver, stats } = useGnssStore(
    useShallow((s) => ({ receiver: s.device.receiver, stats: s.stats })),
  );
  const waiting = t('device.waiting');
  const rf = receiver.rf?.[0];

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Card title={t('device.receiver')}>
        <KeyValueRow
          label={t('device.vendor')}
          value={
            receiver.vendor === 'u-blox'
              ? 'u-blox'
              : receiver.nmeaDetected
                ? t('device.vendorGeneric')
                : waiting
          }
        />
        <KeyValueRow label={t('device.module')} value={receiver.module} />
        <KeyValueRow label={t('device.hardware')} value={receiver.hwVersion} mono />
        <KeyValueRow label={t('device.software')} value={receiver.swVersion} mono />
        <KeyValueRow label={t('device.firmware')} value={receiver.fwVersion} mono />
        <KeyValueRow label={t('device.protocol')} value={receiver.protocolVersion} mono />
        <KeyValueRow label={t('device.uniqueId')} value={receiver.uniqueId} mono />
      </Card>

      {receiver.gnssSupported || receiver.gnssEnabled ? (
        <Card title={t('device.gnss')}>
          <KeyValueRow label={t('device.supported')} value={names(receiver.gnssSupported)} />
          <KeyValueRow label={t('device.enabled')} value={names(receiver.gnssEnabled)} />
          <KeyValueRow label={t('device.maxConcurrent')} value={receiver.maxConcurrentGnss} />
        </Card>
      ) : null}

      {rf ? (
        <Card title={t('device.rf')}>
          <KeyValueRow label={t('device.antenna')} value={rf.antennaStatus?.toUpperCase()} />
          <KeyValueRow label={t('device.antennaPower')} value={rf.antennaPower?.toUpperCase()} />
          <KeyValueRow label={t('device.jamming')} value={rf.jammingState} />
          <KeyValueRow label={t('device.jamIndicator')} value={rf.jamIndicator} />
          <KeyValueRow label={t('device.noise')} value={rf.noisePerMs} />
          <KeyValueRow label={t('device.agc')} value={rf.agcPercent} unit="%" />
        </Card>
      ) : null}

      <Card title={t('device.protocols')}>
        <KeyValueRow
          label={t('device.nmea')}
          value={receiver.nmeaDetected ? t('device.detected') : t('device.notDetected')}
        />
        <KeyValueRow label={t('device.nmeaVersion')} value={receiver.nmeaVersion} />
        <KeyValueRow label={t('device.talkers')} value={receiver.talkers?.join(', ')} mono />
        <KeyValueRow
          label={t('device.ubx')}
          value={receiver.ubxDetected ? t('device.detected') : t('device.notDetected')}
        />
      </Card>

      <Card title={t('device.stream')}>
        <KeyValueRow label={t('device.bytes')} value={stats.bytes.toLocaleString()} mono />
        <KeyValueRow
          label={t('device.frames')}
          value={`${stats.nmeaFrames} / ${stats.ubxFrames} / ${stats.rtcmFrames}`}
          mono
        />
        <KeyValueRow
          label={t('device.errors')}
          value={stats.nmeaChecksumErrors + stats.ubxChecksumErrors + stats.rtcmCrcErrors}
          mono
        />
        <KeyValueRow label={t('device.junk')} value={stats.junkBytes} mono />
      </Card>

      {receiver.infoMessages && receiver.infoMessages.length > 0 ? (
        <Card title={t('device.info')}>
          {[...receiver.infoMessages]
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
