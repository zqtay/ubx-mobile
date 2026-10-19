import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as Clipboard from 'expo-clipboard';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, ToastAndroid, View } from 'react-native';
import { useShallow } from 'zustand/react/shallow';

import { constellationMeta } from '@/domain/constellations';
import { useGnssStore } from '@/state/gnssStore';
import { countSatellites } from '@/state/selectors';
import { useSettings } from '@/state/settingsStore';
import { AppText, Card, DataGate, KeyValueRow } from '@/ui/components';
import { ConstellationBadge } from '@/ui/components/ShapeIcon';
import { fixLabelKey, fixTone } from '@/ui/fixLabel';
import {
  formatCoordinate,
  formatDegrees,
  formatDistance,
  formatDuration,
  formatLatLonPlain,
  formatLocalTime,
  formatNumber,
  formatSpeed,
  formatUtc,
} from '@/ui/format';
import { useAppTheme } from '@/ui/theme/ThemeProvider';
import { minTouchTarget, radius, spacing } from '@/ui/theme/tokens';

export default function StatusScreen() {
  const { t } = useTranslation();
  return (
    <DataGate icon="crosshairs-gps" placeholder={t('screens.status.placeholder')}>
      <StatusContent />
    </DataGate>
  );
}

function StatusContent() {
  const { t } = useTranslation();
  const { colors } = useAppTheme();
  const { fix, dop, session, satellites } = useGnssStore(
    useShallow((s) => ({ fix: s.fix, dop: s.dop, session: s.session, satellites: s.satellites })),
  );
  const { coordinateFormat, units } = useSettings(
    useShallow((s) => ({ coordinateFormat: s.coordinateFormat, units: s.units })),
  );
  const counts = useMemo(() => countSatellites(satellites), [satellites]);
  const fixKey = fixLabelKey(fix);
  const tone = fixTone(fixKey);
  const plain = formatLatLonPlain(fix?.lat, fix?.lon);

  const copy = async () => {
    if (!plain) return;
    await Clipboard.setStringAsync(plain);
    ToastAndroid.show(t('status.copied'), ToastAndroid.SHORT);
  };

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View
        testID="fix-banner"
        accessibilityRole="summary"
        style={[styles.banner, { backgroundColor: colors.surface, borderColor: colors.fix[tone] }]}>
        <View style={styles.bannerRow}>
          <AppText variant="title" color={colors.fix[tone]} style={styles.bannerTitle}>
            {t(`fix.${fixKey}`)}
          </AppText>
          <AppText variant="label" muted>
            {`${session?.ttffSource === 'measured' ? t('status.ttffMeasured') : t('status.ttff')} ${formatDuration(session?.ttffMs)}`}
          </AppText>
        </View>
        <AppText variant="label">
          {t('status.satsSummary', {
            used: counts.total.used,
            signal: counts.total.withSignal,
            view: counts.total.inView,
          })}
        </AppText>
      </View>

      <Card
        title={t('status.position')}
        action={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('status.copy')}
            disabled={!plain}
            onPress={copy}
            hitSlop={8}
            style={[styles.iconButton, !plain && styles.disabled]}>
            <MaterialCommunityIcons name="content-copy" size={20} color={colors.primary} />
          </Pressable>
        }>
        <KeyValueRow
          label={t('status.latitude')}
          value={formatCoordinate(fix?.lat, 'lat', coordinateFormat)}
          mono
        />
        <KeyValueRow
          label={t('status.longitude')}
          value={formatCoordinate(fix?.lon, 'lon', coordinateFormat)}
          mono
        />
        <KeyValueRow
          label={t('status.altitudeMsl')}
          value={formatDistance(fix?.altMslM, units)}
          mono
        />
        <KeyValueRow
          label={t('status.altitudeEllipsoid')}
          value={formatDistance(fix?.altEllipsoidM, units)}
          mono
        />
        <KeyValueRow label={t('status.hAcc')} value={formatDistance(fix?.hAccM, units)} mono />
        <KeyValueRow label={t('status.vAcc')} value={formatDistance(fix?.vAccM, units)} mono />
      </Card>

      <Card title={t('status.motion')}>
        <KeyValueRow label={t('status.speed')} value={formatSpeed(fix?.speedMps, units)} mono />
        <KeyValueRow
          label={t('status.speedAcc')}
          value={formatSpeed(fix?.speedAccMps, units)}
          mono
        />
        <KeyValueRow label={t('status.course')} value={formatDegrees(fix?.courseDeg, 1)} mono />
        <KeyValueRow
          label={t('status.courseAcc')}
          value={formatDegrees(fix?.courseAccDeg, 1)}
          mono
        />
      </Card>

      <Card title={t('status.quality')}>
        <View style={styles.dopGrid}>
          {(
            [
              ['PDOP', dop?.p],
              ['HDOP', dop?.h],
              ['VDOP', dop?.v],
              ['GDOP', dop?.g],
              ['TDOP', dop?.t],
            ] as const
          ).map(([label, value]) => (
            <View
              key={label}
              style={styles.dopCell}
              accessible
              accessibilityLabel={`${label} ${formatNumber(value)}`}>
              <AppText variant="caption" muted>
                {label}
              </AppText>
              <AppText variant="mono">{formatNumber(value)}</AppText>
            </View>
          ))}
        </View>
        {fix?.carrierSolution ? (
          <KeyValueRow
            label={t('status.carrier')}
            value={t(`status.carrierValue.${fix.carrierSolution}`)}
          />
        ) : null}
        {fix?.differential !== undefined ? (
          <KeyValueRow
            label={t('status.differential')}
            value={fix.differential ? t('status.yes') : t('status.no')}
          />
        ) : null}
        {fix?.fixOk !== undefined ? (
          <KeyValueRow
            label={t('status.fixOk')}
            value={fix.fixOk ? t('status.yes') : t('status.no')}
          />
        ) : null}
      </Card>

      <Card title={t('status.time')}>
        <KeyValueRow label={t('status.utc')} value={formatUtc(fix?.utc?.epochMs)} mono />
        <KeyValueRow label={t('status.local')} value={formatLocalTime(fix?.utc?.epochMs)} mono />
        {fix?.utc ? (
          <KeyValueRow
            label={t('status.validity')}
            value={[
              fix.utc.dateValid ? t('status.dateValid') : t('status.dateInvalid'),
              fix.utc.timeValid ? t('status.timeValid') : t('status.timeInvalid'),
              fix.utc.fullyResolved === undefined
                ? undefined
                : fix.utc.fullyResolved
                  ? t('status.resolved')
                  : t('status.unresolved'),
            ]
              .filter(Boolean)
              .join(' · ')}
          />
        ) : null}
        {fix?.leapSeconds !== undefined ? (
          <KeyValueRow
            label={t('status.leapSeconds')}
            value={
              fix.leapSecondsValid
                ? t('status.leapValue', { value: fix.leapSeconds })
                : t('status.leapDefault', { value: fix.leapSeconds })
            }
            mono
          />
        ) : null}
      </Card>

      {counts.byConstellation.length > 0 ? (
        <Card title={t('status.perConstellation')}>
          <AppText variant="caption" muted>
            {t('status.perConstellationHint')}
          </AppText>
          <View style={styles.constellations}>
            {counts.byConstellation.map(({ constellation, counts: c }) => (
              <View key={constellation} style={styles.constellation}>
                <ConstellationBadge constellation={constellation} />
                <AppText variant="label">{constellationMeta(constellation).short}</AppText>
                <AppText variant="mono">{`${c.used}/${c.withSignal}/${c.inView}`}</AppText>
              </View>
            ))}
          </View>
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
  banner: {
    borderRadius: radius.md,
    borderWidth: 2,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  bannerRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  bannerTitle: {
    fontWeight: '800',
  },
  iconButton: {
    width: minTouchTarget,
    height: minTouchTarget - 12,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  disabled: {
    opacity: 0.4,
  },
  dopGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: spacing.sm,
  },
  dopCell: {
    minWidth: 56,
    alignItems: 'center',
  },
  constellations: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.lg,
  },
  constellation: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
});
