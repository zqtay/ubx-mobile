import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Tabs } from 'expo-router/tabs';
import type { ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';

import { HeaderStatusChip } from '@/ui/components';
import { useAppTheme } from '@/ui/theme/ThemeProvider';

type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

// Satellites is the default tab (functional spec §1), also when the app is opened by a deep link.
export const unstable_settings = { anchor: 'satellites' };

const tabs = [
  { name: 'status', icon: 'crosshairs-gps', titleKey: 'tabs.status' },
  { name: 'satellites', icon: 'satellite-variant', titleKey: 'tabs.satellites' },
  { name: 'sky', icon: 'radar', titleKey: 'tabs.sky' },
  { name: 'map', icon: 'map-outline', titleKey: 'tabs.map' },
  { name: 'device', icon: 'chip', titleKey: 'tabs.device' },
  { name: 'more', icon: 'dots-horizontal', titleKey: 'tabs.more' },
] as const satisfies readonly { name: string; icon: IconName; titleKey: string }[];

export default function TabLayout() {
  const { t } = useTranslation();
  const { colors } = useAppTheme();

  return (
    <Tabs
      screenOptions={{
        headerRight: () => <HeaderStatusChip />,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
      }}>
      {tabs.map(({ name, icon, titleKey }) => (
        <Tabs.Screen
          key={name}
          name={name}
          options={{
            title: t(titleKey),
            tabBarIcon: ({ focused, size }) => (
              <MaterialCommunityIcons
                name={icon}
                color={focused ? colors.primary : colors.textMuted}
                size={size}
              />
            ),
          }}
        />
      ))}
    </Tabs>
  );
}
