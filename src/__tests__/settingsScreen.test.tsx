import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';
import { Alert } from 'react-native';

import { flagEmoji } from '@/domain/constellations';
import { useSettings } from '@/state/settingsStore';

const APP = './src/app';
jest.setTimeout(20_000);

beforeEach(() => useSettings.getState().reset());

describe('Settings screen (REQ-SET, functional spec §9)', () => {
  it('changes display, appearance and USB settings', async () => {
    await renderRouter(APP, { initialUrl: '/settings' });
    await fireEvent(screen.getByLabelText('Show constellation flags'), 'valueChange', true);
    await fireEvent.press(screen.getByRole('radio', { name: 'DMS' }));
    await fireEvent.press(screen.getByRole('radio', { name: 'Imperial' }));
    await fireEvent.press(screen.getByRole('radio', { name: '5 Hz' }));
    await fireEvent.press(screen.getByRole('radio', { name: '10 s' }));
    await fireEvent(screen.getByLabelText('Keep screen on'), 'valueChange', false);
    await fireEvent.press(screen.getByRole('radio', { name: '1 h' }));
    await fireEvent.press(screen.getByLabelText('Baud rate: 57600'));
    await fireEvent(screen.getByLabelText('Set DTR/RTS on open'), 'valueChange', false);
    expect(useSettings.getState()).toMatchObject({
      showFlags: true,
      coordinateFormat: 'dms',
      units: 'imperial',
      refreshRateHz: 5,
      satelliteTimeoutS: 10,
      keepScreenOn: false,
      skyTrails: '1h',
      usb: { defaultBaud: 57600, setDtrRts: false },
    });
  });

  it('asks before enabling periodic UBX output', async () => {
    const alert = jest.spyOn(Alert, 'alert');
    await renderRouter(APP, { initialUrl: '/settings' });
    await fireEvent.press(screen.getByRole('radio', { name: 'Periodic output (RAM)' }));
    expect(useSettings.getState().usb.ubxMode).toBe('poll');
    expect(alert.mock.calls[0][0]).toBe('Enable periodic output?');
    await act(async () => alert.mock.calls[0][2]![1].onPress!());
    expect(useSettings.getState().usb.ubxMode).toBe('periodic-ram');
    await fireEvent.press(screen.getByRole('radio', { name: 'Poll (safe)' }));
    expect(useSettings.getState().usb.ubxMode).toBe('poll');
    alert.mockRestore();
  });

  it('builds constellation flags from regional indicators', () => {
    expect(flagEmoji('GALILEO')).toBe('🇪🇺');
    expect(flagEmoji('GPS')).toBe('🇺🇸');
    expect(flagEmoji('SBAS')).toBeUndefined();
  });
});
