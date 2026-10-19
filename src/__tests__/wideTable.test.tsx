import { act, fireEvent, renderRouter, screen, within } from 'expo-router/testing-library';
import { Dimensions } from 'react-native';

import { emptySnapshot, useGnssStore } from '@/state/gnssStore';
import { useSettings } from '@/state/settingsStore';

import { demoSnapshot } from '../../test/helpers/demo';

jest.setTimeout(20_000);

const setWindow = (width: number, height: number) =>
  Dimensions.set({
    window: { width, height, scale: 3, fontScale: 1 },
    screen: { width, height, scale: 3, fontScale: 1 },
  });

beforeEach(() => {
  useSettings.getState().reset();
  useGnssStore.setState(emptySnapshot(), true);
});
afterEach(() => setWindow(390, 844));

describe('landscape / tablet satellite table (REQ-SAT-09, functional spec §4.2)', () => {
  it('shows u-center columns with Y/N/? cells on wide windows', async () => {
    setWindow(844, 390);
    useGnssStore.setState(demoSnapshot(), true);
    const router = await renderRouter('./src/app', { initialUrl: '/satellites' });
    expect(screen.getByTestId('satellite-wide-table')).toBeTruthy();
    expect(screen.queryByTestId('satellite-list')).toBeNull();
    for (const title of ['GNSS', 'Signal', 'Residual', 'Qi', 'Orbit', 'DGNSS', 'EPH', 'ANO']) {
      expect(screen.getByText(title)).toBeTruthy();
    }
    expect(screen.getAllByText('● Y').length).toBeGreaterThan(0);
    await fireEvent.press(screen.getByTestId('wide-row-GPS:5'));
    expect(router.getPathname()).toBe('/satellite/GPS:5');
  });

  it('uses the phone list in portrait', async () => {
    useGnssStore.setState(demoSnapshot(), true);
    await renderRouter('./src/app', { initialUrl: '/satellites' });
    expect(screen.getByTestId('satellite-list')).toBeTruthy();
    await act(async () => undefined);
    expect(within(screen.getByTestId('satellite-list')).queryByTestId('wide-row-GPS:5')).toBeNull();
  });
});
