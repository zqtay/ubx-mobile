import { fireEvent, renderRouter, screen } from 'expo-router/testing-library';

import { emptySnapshot, useGnssStore } from '@/state/gnssStore';
import { useSettings } from '@/state/settingsStore';
import { barsOf } from '@/ui/chart/SignalChart';

import { demoSnapshot } from '../../test/helpers/demo';

jest.setTimeout(20_000);

beforeEach(() => {
  useSettings.getState().reset();
  useGnssStore.setState(emptySnapshot(), true);
});

describe('signal strength chart (REQ-SAT-11, functional spec §4.3)', () => {
  it('replaces the list with the chart and opens the detail from a bar', async () => {
    useGnssStore.setState(demoSnapshot(), true);
    const router = await renderRouter('./src/app', { initialUrl: '/satellites' });
    await fireEvent.press(screen.getByRole('button', { name: 'Show signal chart' }));
    expect(screen.getByTestId('signal-chart')).toBeTruthy();
    expect(screen.queryByTestId('satellite-list')).toBeNull();
    const bar = screen.getByTestId('chart-sv-GPS:5');
    expect(bar.props.accessibilityLabel).toMatch(/^G5, GPS, C\/N0 /);
    await fireEvent.press(bar);
    expect(router.getPathname()).toBe('/satellite/GPS:5');
  });

  it('draws one bar per signal for multi-signal satellites', () => {
    const sat = demoSnapshot().satellites.find((s) => s.signals.length > 1)!;
    expect(barsOf(sat)).toHaveLength(sat.signals.length);
    const single = { ...sat, signals: [] };
    expect(barsOf(single)).toEqual([{ cn0: sat.cn0, used: sat.used === true }]);
  });
});
