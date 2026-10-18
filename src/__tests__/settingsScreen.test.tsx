import { fireEvent, render, screen } from '@testing-library/react-native';

import { useSettings } from '@/state/settingsStore';
import { ThemeProvider } from '@/ui/theme/ThemeProvider';

import SettingsScreen from '@/app/settings';

describe('Settings screen', () => {
  beforeEach(() => {
    useSettings.getState().reset();
  });

  it('switches the theme preference', async () => {
    await render(
      <ThemeProvider>
        <SettingsScreen />
      </ThemeProvider>,
    );

    expect(screen.getByRole('radio', { name: 'System' })).toBeChecked();
    await fireEvent.press(screen.getByRole('radio', { name: 'Dark' }));

    expect(useSettings.getState().theme).toBe('dark');
    expect(screen.getByRole('radio', { name: 'Dark' })).toBeChecked();
  });

  it('switches the satellite label style', async () => {
    await render(
      <ThemeProvider>
        <SettingsScreen />
      </ThemeProvider>,
    );
    await fireEvent.press(screen.getByRole('radio', { name: 'RINEX (G, R, E, C)' }));
    expect(useSettings.getState().svLabelStyle).toBe('rinex');
  });
});
