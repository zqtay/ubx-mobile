import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider as NavigationThemeProvider,
  type Theme as NavigationTheme,
} from 'expo-router';
import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { Appearance, useColorScheme } from 'react-native';

import { useSettings } from '@/state/settingsStore';

import { palettes, type ColorSchemeName, type Palette } from './tokens';

export interface AppTheme {
  scheme: ColorSchemeName;
  colors: Palette;
}

const ThemeContext = createContext<AppTheme>({ scheme: 'light', colors: palettes.light });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const preference = useSettings((s) => s.theme);

  // Applying the override natively also themes system dialogs and pickers.
  useEffect(() => {
    Appearance.setColorScheme(preference === 'system' ? 'unspecified' : preference);
  }, [preference]);

  const systemScheme = useColorScheme();
  const scheme: ColorSchemeName =
    preference === 'system' ? (systemScheme === 'dark' ? 'dark' : 'light') : preference;

  const value = useMemo<AppTheme>(() => ({ scheme, colors: palettes[scheme] }), [scheme]);
  const navigationTheme = useMemo(() => toNavigationTheme(value), [value]);

  return (
    <ThemeContext.Provider value={value}>
      <NavigationThemeProvider value={navigationTheme}>{children}</NavigationThemeProvider>
    </ThemeContext.Provider>
  );
}

export function useAppTheme(): AppTheme {
  return useContext(ThemeContext);
}

function toNavigationTheme({ scheme, colors }: AppTheme): NavigationTheme {
  const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
  return {
    ...base,
    dark: scheme === 'dark',
    colors: {
      ...base.colors,
      primary: colors.primary,
      background: colors.bg,
      card: colors.surface,
      text: colors.text,
      border: colors.border,
      notification: colors.danger,
    },
  };
}
