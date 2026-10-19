import { fireEvent, renderRouter, screen, within } from 'expo-router/testing-library';

import { KEY } from '@/config/keys';
import { useConfigStore } from '@/sources';
import { emptySnapshot, useGnssStore } from '@/state/gnssStore';

import { BE122_DUMP } from '../../test/fixtures/m10Dumps';
import { dumpRamValues } from '../../test/helpers/configSim';
import { demoSnapshot } from '../../test/helpers/demo';

jest.setTimeout(20_000);
const BE122 = dumpRamValues(BE122_DUMP);
const initial = useConfigStore.getState();

beforeEach(() => {
  useGnssStore.setState(
    { ...demoSnapshot(), source: 'usb', connection: { kind: 'receiving' } },
    true,
  );
  const bbr = new Map([[KEY.NAVSPG_DYNMODEL, 4]]);
  useConfigStore.setState(
    {
      ...initial,
      status: 'ready',
      port: 'UART1',
      baud: 57600,
      ram: new Map(BE122),
      bbr,
      def: new Map(BE122),
      allLoaded: true,
      staged: new Map(),
    },
    true,
  );
});
afterAll(() => useGnssStore.setState(emptySnapshot(), true));

describe('advanced key editor (REQ-CFG-17)', () => {
  it('lists every key grouped, searches and edits enum, raw and unknown keys', async () => {
    await renderRouter('./src/app', { initialUrl: '/config/advanced' });
    expect(screen.getByText(`${BE122.size} keys`)).toBeTruthy();

    await fireEvent.changeText(screen.getByLabelText('Search by name, ID or group'), 'dynmodel');
    expect(screen.getByText('1 key')).toBeTruthy();
    expect(screen.getByText('CFG-NAVSPG')).toBeTruthy();
    const row = screen.getByTestId('key-0x20110021');
    // Saved (BBR) 4 differs from current 0: unsaved.
    expect(within(row).getByText(/● unsaved/)).toBeTruthy();
    await fireEvent.press(within(row).getByRole('button'));
    await fireEvent.press(within(row).getByRole('checkbox', { name: 'Pedestrian' }));
    expect(useConfigStore.getState().staged.get(KEY.NAVSPG_DYNMODEL)).toBe(3);
    await fireEvent.press(
      within(row).getByRole('button', { name: 'Use saved value (4 (Automotive))' }),
    );
    expect(useConfigStore.getState().staged.get(KEY.NAVSPG_DYNMODEL)).toBe(4);

    await fireEvent.changeText(screen.getByLabelText('Search by name, ID or group'), '0x40d00014');
    const unknown = screen.getByTestId('key-0x40D00014');
    await fireEvent.press(within(unknown).getByRole('button'));
    expect(within(unknown).getByText(/does not know this key/)).toBeTruthy();
    const input = within(unknown).getByLabelText('New value for 0x40D00014');
    await fireEvent.changeText(input, 'nope');
    await fireEvent.press(within(unknown).getByRole('button', { name: 'Stage' }));
    expect(
      within(unknown).getByText('Not a valid U4 value (decimal, or hex with 0x).'),
    ).toBeTruthy();
    await fireEvent.changeText(input, '0x40');
    await fireEvent.press(within(unknown).getByRole('button', { name: 'Stage' }));
    expect(useConfigStore.getState().staged.get(0x40d00014)).toBe(64);
    expect(screen.getByTestId('staged-bar')).toBeTruthy();
  });
});
