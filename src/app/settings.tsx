import { useTranslation } from 'react-i18next';
import { Alert, StyleSheet, Switch, View } from 'react-native';

import {
  useSettings,
  type BaudSetting,
  type CoordinateFormat,
  type RefreshRateHz,
  type SatelliteTimeoutS,
  type SkyTrails,
  type SvLabelStyle,
  type ThemePreference,
  type UbxDataMode,
  type UnitSystem,
} from '@/state/settingsStore';
import { AppText, Card, Chip, Screen, SegmentedControl } from '@/ui/components';
import { useAppTheme } from '@/ui/theme/ThemeProvider';
import { spacing, switchColors } from '@/ui/theme/tokens';

const BAUDS: BaudSetting[] = [
  'auto',
  4800,
  9600,
  19200,
  38400,
  57600,
  115200,
  230400,
  460800,
  921600,
];

/** App settings (REQ-SET, functional spec §9). */
export default function SettingsScreen() {
  const { t } = useTranslation();
  const s = useSettings();
  const { update, updateUsb } = s;

  const setUbxMode = (mode: UbxDataMode) => {
    if (mode === 'poll') {
      updateUsb({ ubxMode: mode });
      return;
    }
    Alert.alert(t('settings.ubxPeriodicTitle'), t('settings.ubxPeriodicMessage'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('settings.continue'), onPress: () => updateUsb({ ubxMode: mode }) },
    ]);
  };

  return (
    <Screen stackPage>
      <Card title={t('settings.appearance')}>
        <Field label={t('settings.theme')}>
          <SegmentedControl<ThemePreference>
            label={t('settings.theme')}
            value={s.theme}
            onChange={(value) => update({ theme: value })}
            options={[
              { value: 'system', label: t('settings.themeSystem') },
              { value: 'light', label: t('settings.themeLight') },
              { value: 'dark', label: t('settings.themeDark') },
            ]}
          />
        </Field>
        <Field label={t('settings.svLabelStyle')}>
          <SegmentedControl<SvLabelStyle>
            label={t('settings.svLabelStyle')}
            value={s.svLabelStyle}
            onChange={(value) => update({ svLabelStyle: value })}
            options={[
              { value: 'ucenter', label: t('settings.svLabelUcenter') },
              { value: 'rinex', label: t('settings.svLabelRinex') },
            ]}
          />
        </Field>
        <SwitchRow
          label={t('settings.showFlags')}
          hint={t('settings.showFlagsHint')}
          value={s.showFlags}
          onChange={(value) => update({ showFlags: value })}
        />
        <Field label={t('settings.coordinateFormat')}>
          <SegmentedControl<CoordinateFormat>
            label={t('settings.coordinateFormat')}
            value={s.coordinateFormat}
            onChange={(value) => update({ coordinateFormat: value })}
            options={[
              { value: 'dd', label: t('settings.coordDd') },
              { value: 'dms', label: t('settings.coordDms') },
              { value: 'ddm', label: t('settings.coordDdm') },
            ]}
          />
        </Field>
        <Field label={t('settings.units')}>
          <SegmentedControl<UnitSystem>
            label={t('settings.units')}
            value={s.units}
            onChange={(value) => update({ units: value })}
            options={[
              { value: 'metric', label: t('settings.metric') },
              { value: 'imperial', label: t('settings.imperial') },
            ]}
          />
        </Field>
      </Card>

      <Card title={t('settings.display')}>
        <Field label={t('settings.refreshRate')}>
          <SegmentedControl<RefreshRateHz>
            label={t('settings.refreshRate')}
            value={s.refreshRateHz}
            onChange={(value) => update({ refreshRateHz: value })}
            options={([1, 2, 5] as const).map((v) => ({ value: v, label: `${v} Hz` }))}
          />
        </Field>
        <Field label={t('settings.satelliteTimeout')} hint={t('settings.satelliteTimeoutHint')}>
          <SegmentedControl<SatelliteTimeoutS>
            label={t('settings.satelliteTimeout')}
            value={s.satelliteTimeoutS}
            onChange={(value) => update({ satelliteTimeoutS: value })}
            options={([3, 5, 10, 30] as const).map((v) => ({ value: v, label: `${v} s` }))}
          />
        </Field>
        <SwitchRow
          label={t('settings.keepScreenOn')}
          hint={t('settings.keepScreenOnHint')}
          value={s.keepScreenOn}
          onChange={(value) => update({ keepScreenOn: value })}
        />
        <SwitchRow
          label={t('settings.skyDenseGrid')}
          value={s.skyDenseGrid}
          onChange={(value) => update({ skyDenseGrid: value })}
        />
        <SwitchRow
          label={t('settings.skyLabels')}
          value={s.skyLabels}
          onChange={(value) => update({ skyLabels: value })}
        />
        <Field label={t('settings.skyTrails')}>
          <SegmentedControl<SkyTrails>
            label={t('settings.skyTrails')}
            value={s.skyTrails}
            onChange={(value) => update({ skyTrails: value })}
            options={[
              { value: 'off', label: t('settings.trailsOff') },
              { value: '10m', label: t('settings.trails10m') },
              { value: '1h', label: t('settings.trails1h') },
            ]}
          />
        </Field>
      </Card>

      <Card title={t('settings.usb')}>
        <AppText variant="caption" muted>
          {t('settings.usbHint')}
        </AppText>
        <Field label={t('settings.defaultBaud')}>
          <View style={styles.chips}>
            {BAUDS.map((b) => (
              <Chip
                key={b}
                label={b === 'auto' ? t('settings.baudAuto') : String(b)}
                accessibilityLabel={`${t('settings.defaultBaud')}: ${b === 'auto' ? t('settings.baudAuto') : b}`}
                selected={s.usb.defaultBaud === b}
                onPress={() => updateUsb({ defaultBaud: b })}
              />
            ))}
          </View>
        </Field>
        <SwitchRow
          label={t('settings.probeUbx')}
          hint={t('settings.probeUbxHint')}
          value={s.usb.probeUbx}
          onChange={(value) => updateUsb({ probeUbx: value })}
        />
        <Field label={t('settings.ubxMode')} hint={t('settings.ubxPeriodicHint')}>
          <SegmentedControl<UbxDataMode>
            label={t('settings.ubxMode')}
            value={s.usb.ubxMode}
            onChange={setUbxMode}
            options={[
              { value: 'poll', label: t('settings.ubxPoll') },
              { value: 'periodic-ram', label: t('settings.ubxPeriodic') },
            ]}
          />
        </Field>
        <SwitchRow
          label={t('settings.setDtrRts')}
          hint={t('settings.setDtrRtsHint')}
          value={s.usb.setDtrRts}
          onChange={(value) => updateUsb({ setDtrRts: value })}
        />
      </Card>
    </Screen>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.field}>
      <AppText variant="label" muted>
        {label}
      </AppText>
      {children}
      {hint ? (
        <AppText variant="caption" muted>
          {hint}
        </AppText>
      ) : null}
    </View>
  );
}

function SwitchRow({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  const { colors } = useAppTheme();
  return (
    <View style={styles.switchRow}>
      <View style={styles.flex}>
        <AppText variant="label">{label}</AppText>
        {hint ? (
          <AppText variant="caption" muted>
            {hint}
          </AppText>
        ) : null}
      </View>
      <Switch
        accessibilityLabel={label}
        value={value}
        onValueChange={onChange}
        {...switchColors(colors, value)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    gap: spacing.xs,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 48,
  },
  flex: {
    flex: 1,
  },
});
