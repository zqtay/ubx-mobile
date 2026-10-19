import '@/i18n';

import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { restoreLastSource } from '@/sources';
import { useKeepScreenOn } from '@/ui/hooks/useKeepScreenOn';
import { ThemeProvider, useAppTheme } from '@/ui/theme/ThemeProvider';

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider>
        <RootStack />
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}

function RootStack() {
  const { t } = useTranslation();
  const { scheme, colors } = useAppTheme();
  useKeepScreenOn();

  // Restart the remembered source on launch (REQ-SRC-04).
  useEffect(() => {
    void restoreLastSource();
  }, []);

  return (
    <>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack>
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="console" options={{ title: t('screens.console.title') }} />
        <Stack.Screen name="settings" options={{ title: t('settings.title') }} />
        <Stack.Screen name="about" options={{ title: t('about.title') }} />
        <Stack.Screen name="config/index" options={{ title: t('config.title') }} />
        <Stack.Screen name="config/[section]" options={{ title: t('config.title') }} />
        <Stack.Screen name="config/backups" options={{ title: t('config.backups.title') }} />
        <Stack.Screen name="config/advanced" options={{ title: t('config.advanced.title') }} />
        <Stack.Screen name="config/restore" options={{ title: t('config.restore.title') }} />
        <Stack.Screen
          name="source"
          options={{
            presentation: 'formSheet',
            sheetAllowedDetents: [0.6, 0.95],
            sheetCornerRadius: 16,
            contentStyle: { backgroundColor: colors.bg },
          }}
        />
        <Stack.Screen
          name="satellite/[key]"
          options={{
            presentation: 'formSheet',
            sheetAllowedDetents: [0.55, 0.95],
            sheetCornerRadius: 16,
            contentStyle: { backgroundColor: colors.bg },
          }}
        />
      </Stack>
    </>
  );
}
