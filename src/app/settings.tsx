import { useTranslation } from 'react-i18next';

import { useSettings, type SvLabelStyle, type ThemePreference } from '@/state/settingsStore';
import { AppText, Card, Screen, SegmentedControl } from '@/ui/components';

export default function SettingsScreen() {
  const { t } = useTranslation();
  const theme = useSettings((s) => s.theme);
  const svLabelStyle = useSettings((s) => s.svLabelStyle);
  const update = useSettings((s) => s.update);

  return (
    <Screen>
      <Card title={t('settings.appearance')}>
        <AppText variant="label" muted>
          {t('settings.theme')}
        </AppText>
        <SegmentedControl<ThemePreference>
          label={t('settings.theme')}
          value={theme}
          onChange={(value) => update({ theme: value })}
          options={[
            { value: 'system', label: t('settings.themeSystem') },
            { value: 'light', label: t('settings.themeLight') },
            { value: 'dark', label: t('settings.themeDark') },
          ]}
        />
        <AppText variant="label" muted>
          {t('settings.svLabelStyle')}
        </AppText>
        <SegmentedControl<SvLabelStyle>
          label={t('settings.svLabelStyle')}
          value={svLabelStyle}
          onChange={(value) => update({ svLabelStyle: value })}
          options={[
            { value: 'ucenter', label: t('settings.svLabelUcenter') },
            { value: 'rinex', label: t('settings.svLabelRinex') },
          ]}
        />
      </Card>
      <AppText variant="caption" muted>
        {t('settings.more')}
      </AppText>
    </Screen>
  );
}
