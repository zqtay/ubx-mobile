import { renderRouter, screen, within } from 'expo-router/testing-library';

import { useConfigStore } from '@/sources';
import { emptySnapshot, useGnssStore } from '@/state/gnssStore';
import { useSettings } from '@/state/settingsStore';

import { BE122_DUMP } from '../../test/fixtures/m10Dumps';
import { dumpRamValues } from '../../test/helpers/configSim';
import { demoSnapshot } from '../../test/helpers/demo';

jest.setTimeout(30_000);

const SCREENS = [
  '/status',
  '/satellites',
  '/sky',
  '/map',
  '/device',
  '/more',
  '/settings',
  '/console',
  '/config',
  '/config/rate',
  '/config/power',
];

beforeAll(() => {
  useSettings.getState().reset();
  useGnssStore.setState(
    { ...demoSnapshot(), source: 'usb', connection: { kind: 'receiving' } },
    true,
  );
  const ram = dumpRamValues(BE122_DUMP);
  useConfigStore.setState({
    status: 'ready',
    port: 'UART1',
    baud: 57600,
    ram,
    def: new Map(ram),
    staged: new Map(),
  });
});
afterAll(() => useGnssStore.setState(emptySnapshot(), true));

describe('screen-reader names (REQ-NFR-07, M6 accessibility pass)', () => {
  it.each(SCREENS)('every button on %s has an accessible name', async (url) => {
    await renderRouter('./src/app', { initialUrl: url });
    const unnamed = [...screen.queryAllByRole('button'), ...screen.queryAllByRole('link')].filter(
      (el) => !el.props.accessibilityLabel && within(el).queryAllByText(/\S/).length === 0,
    );
    expect(unnamed.map((el) => el.props.testID ?? el.type)).toEqual([]);
  });
});
