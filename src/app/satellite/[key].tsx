import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { router, useLocalSearchParams } from 'expo-router';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { constellationMeta, svLabel } from '@/domain/constellations';
import type { Satellite } from '@/domain/types';
import { useGnssStore } from '@/state/gnssStore';
import { useSettings } from '@/state/settingsStore';
import { AppText, Card, KeyValueRow } from '@/ui/components';
import { ConstellationBadge } from '@/ui/components/ShapeIcon';
import { DASH } from '@/ui/format';
import { Cn0Bar } from '@/ui/satellites/Cn0Bar';
import { useAppTheme } from '@/ui/theme/ThemeProvider';
import { minTouchTarget, spacing } from '@/ui/theme/tokens';

type Row = { label: string; value: string | number | undefined; unit?: string };

const yesNo = (t: TFunction, v: boolean | undefined) =>
  v === undefined ? undefined : v ? t('detail.yes') : t('detail.no');

/**
 * Detail content: the always-shown main rows plus titled sections, each shown only if at least
 * one of its values is known for this source (REQ-SAT-05).
 */
function detailContent(
  t: TFunction,
  sat: Satellite,
): { main: Row[]; sections: { title: string; rows: Row[] }[] } {
  const corrections = sat.corrections
    ? Object.entries(sat.corrections)
        .filter(([, used]) => used)
        .map(([name]) => name.toUpperCase())
        .join(', ') || t('detail.none')
    : undefined;
  const main: Row[] = [
    { label: t('detail.elevation'), value: sat.elevation, unit: '°' },
    { label: t('detail.azimuth'), value: sat.azimuth, unit: '°' },
    { label: t('detail.used'), value: yesNo(t, sat.used) },
    { label: t('detail.health'), value: sat.health && t(`detail.healthValue.${sat.health}`) },
    {
      label: t('detail.quality'),
      value:
        sat.quality !== undefined
          ? `${sat.quality} – ${t(`detail.qualityValue.${sat.quality}` as 'detail.qualityValue.0')}`
          : undefined,
    },
    { label: t('detail.residual'), value: sat.prResidualM?.toFixed(1), unit: 'm' },
  ];
  const sections = [
    {
      title: t('detail.orbit'),
      rows: [
        {
          label: t('detail.orbit'),
          value: sat.orbitSource && t(`detail.orbitValue.${sat.orbitSource}`),
        },
        { label: t('detail.ephemeris'), value: yesNo(t, sat.hasEphemeris) },
        { label: t('detail.almanac'), value: yesNo(t, sat.hasAlmanac) },
        { label: t('detail.aop'), value: yesNo(t, sat.hasAop) },
        { label: t('detail.ano'), value: yesNo(t, sat.hasAno) },
      ],
    },
    {
      title: t('detail.corrections'),
      rows: [
        { label: t('detail.dgnss'), value: yesNo(t, sat.diffCorr) },
        { label: t('detail.corrections'), value: corrections },
      ],
    },
    {
      title: t('detail.source'),
      rows: [
        { label: t('detail.source'), value: t(`detail.originValue.${sat.origin}`) },
        { label: t('detail.basebandCn0'), value: sat.basebandCn0?.toFixed(1), unit: 'dB-Hz' },
        { label: t('detail.glonassFcn'), value: sat.glonassFcn },
      ],
    },
  ].filter((section) => section.rows.some((r) => r.value !== undefined));
  return { main, sections };
}

export default function SatelliteDetail() {
  const { t } = useTranslation();
  const { colors } = useAppTheme();
  const { key } = useLocalSearchParams<{ key: string }>();
  const sat = useGnssStore((s) => s.satellites.find((x) => x.key === key));
  const labelStyle = useSettings((s) => s.svLabelStyle);

  return (
    <ScrollView
      testID="satellite-detail"
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={styles.content}>
      <View style={styles.titleRow}>
        {sat ? <ConstellationBadge constellation={sat.constellation} size={20} /> : null}
        <AppText variant="title" accessibilityRole="header" style={styles.title}>
          {sat
            ? t('detail.title', {
                label: svLabel(sat.constellation, sat.svid, labelStyle, sat.glonassFcn),
                constellation: constellationMeta(sat.constellation).name,
                svid: sat.svid || '',
              })
            : key}
        </AppText>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('detail.close')}
          onPress={() => router.back()}
          hitSlop={8}
          style={styles.close}>
          <MaterialCommunityIcons name="close" size={24} color={colors.text} />
        </Pressable>
      </View>

      {!sat ? (
        <AppText muted>{t('detail.gone')}</AppText>
      ) : (
        <>
          <Card>
            <View style={styles.cn0Row}>
              <AppText variant="label" muted>
                {t('detail.cn0')}
              </AppText>
              <Cn0Bar cn0={sat.cn0} width={120} />
            </View>
            {detailContent(t, sat).main.map((r) => (
              <KeyValueRow
                key={r.label}
                label={r.label}
                value={r.value}
                unit={r.value !== undefined ? r.unit : undefined}
              />
            ))}
          </Card>

          {sat.signals.length > 0 ? (
            <Card title={t('detail.signals')}>
              {sat.signals.map((s) => (
                <View key={s.code} style={styles.signal}>
                  <AppText variant="mono" style={styles.signalName}>
                    {s.label}
                  </AppText>
                  <Cn0Bar cn0={s.cn0} width={60} />
                  <AppText variant="caption" muted style={styles.signalMeta}>
                    {[
                      s.quality !== undefined ? `Qi ${s.quality}` : undefined,
                      s.used ? t('sky.used').toLowerCase() : undefined,
                      s.prResidualM !== undefined ? `${s.prResidualM.toFixed(1)} m` : undefined,
                    ]
                      .filter(Boolean)
                      .join(' · ') || DASH}
                  </AppText>
                </View>
              ))}
            </Card>
          ) : null}

          {detailContent(t, sat).sections.map((section) => (
            <Card key={section.title} title={section.title}>
              {section.rows.map((r) => (
                <KeyValueRow
                  key={r.label}
                  label={r.label}
                  value={r.value}
                  unit={r.value !== undefined ? r.unit : undefined}
                />
              ))}
            </Card>
          ))}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: spacing.lg,
    gap: spacing.md,
    paddingBottom: spacing.xxl,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  title: {
    flex: 1,
  },
  close: {
    width: minTouchTarget,
    height: minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cn0Row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 28,
  },
  signal: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 28,
  },
  signalName: {
    width: 64,
  },
  signalMeta: {
    flex: 1,
    textAlign: 'right',
  },
});
