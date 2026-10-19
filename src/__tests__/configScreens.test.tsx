import { router as navigation } from 'expo-router';
import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';
import { Alert } from 'react-native';

import { KEY } from '@/config/keys';
import { useConfigStore } from '@/sources';
import { emptySnapshot, useGnssStore } from '@/state/gnssStore';
import { useSettings } from '@/state/settingsStore';

import { BE122_DUMP } from '../../test/fixtures/m10Dumps';
import { dumpRamValues } from '../../test/helpers/configSim';
import { demoSnapshot } from '../../test/helpers/demo';

const APP = './src/app';
jest.setTimeout(20_000);

const BE122 = dumpRamValues(BE122_DUMP);
const initialActions = useConfigStore.getState();

/** A BE-122 on USB whose configuration has been read (DYNMODEL applied but not saved). */
function connectedReceiver() {
  const demo = demoSnapshot();
  useGnssStore.setState({ ...demo, source: 'usb', connection: { kind: 'receiving' } }, true);
  const ram = new Map(BE122);
  ram.set(KEY.NAVSPG_DYNMODEL, 4);
  useConfigStore.setState({
    status: 'ready',
    port: 'UART1',
    baud: 57600,
    ram,
    bbr: new Map(),
    flash: new Map(),
    def: new Map(BE122),
    hasFlash: false,
    staged: new Map(),
    busy: undefined,
    lastOutcome: undefined,
  });
}

beforeEach(() => {
  useSettings.getState().reset();
  useGnssStore.setState(emptySnapshot(), true);
  useConfigStore.setState({ ...initialActions }, true);
  useConfigStore.getState().reset();
});

describe('configuration entry points (REQ-CFG-01)', () => {
  it('is disabled in More without a u-blox receiver on USB', async () => {
    useGnssStore.setState(demoSnapshot(), true);
    await renderRouter(APP, { initialUrl: '/more' });
    const entry = screen.getByRole('button', { name: /Receiver configuration/ });
    expect(entry.props.accessibilityState).toMatchObject({ disabled: true });
    expect(screen.getByText('Requires a connected u-blox receiver')).toBeTruthy();
  });

  it('opens from More and from the Device screen when a receiver is connected', async () => {
    connectedReceiver();
    const router = await renderRouter(APP, { initialUrl: '/more' });
    await fireEvent.press(screen.getByRole('button', { name: /Receiver configuration/ }));
    expect(router.getPathname()).toBe('/config');

    await act(async () => navigation.replace('/device'));
    await fireEvent.press(screen.getByRole('button', { name: 'Configure receiver' }));
    expect(router.getPathname()).toBe('/config');
  });
});

describe('configuration overview (functional spec §11.2)', () => {
  it('summarises sections, unsaved settings and offers actions', async () => {
    connectedReceiver();
    await renderRouter(APP, { initialUrl: '/config' });
    expect(screen.getByText('UART1 · 57600 Bd')).toBeTruthy();
    expect(screen.getByText('● 1 unsaved')).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Rate & timing\. 10 Hz/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Port & protocols\. 57600 · UBX/ })).toBeTruthy();
    expect(
      screen.getByRole('button', { name: /^Navigation\. Automotive\. ● unsaved/ }),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: /^Save permanently/ }).props.accessibilityState,
    ).toMatchObject({ disabled: false });

    const save = jest.fn(async () => undefined);
    useConfigStore.setState({ save });
    const alert = jest.spyOn(Alert, 'alert');
    await fireEvent.press(screen.getByRole('button', { name: /^Save permanently/ }));
    expect(alert).toHaveBeenCalledWith(
      'Make these changes permanent?',
      'Dynamic model: Portable → Automotive',
      expect.any(Array),
    );
    await act(async () => alert.mock.calls[0][2]![1].onPress!());
    expect(save).toHaveBeenCalled();

    const restart = jest.fn(async () => undefined);
    useConfigStore.setState({ restart });
    await fireEvent.press(screen.getByRole('button', { name: 'Cold' }));
    expect(restart).toHaveBeenCalledWith('cold');
    alert.mockRestore();
  });

  it('shows the result of the last action', async () => {
    connectedReceiver();
    useConfigStore.setState({
      lastOutcome: {
        action: 'apply',
        status: 'mismatch',
        mismatches: [{ key: KEY.RATE_MEAS, expected: 50, actual: 100 }],
      },
    });
    await renderRouter(APP, { initialUrl: '/config' });
    expect(
      screen.getByText(
        'Applied, but the receiver reports different values: CFG-RATE-MEAS is 100, expected 50',
      ),
    ).toBeTruthy();
  });

  it('shows a retry when the configuration could not be read', async () => {
    connectedReceiver();
    const load = jest.fn(async () => undefined);
    useConfigStore.setState({ status: 'error', error: 'timeout', load });
    await renderRouter(APP, { initialUrl: '/config' });
    await fireEvent.press(screen.getByRole('button', { name: 'Retry' }));
    expect(load).toHaveBeenCalled();
  });
});

describe('configuration sections (functional spec §11.3)', () => {
  it('stages a change, shows it struck through and applies it from the bar', async () => {
    connectedReceiver();
    await renderRouter(APP, { initialUrl: '/config/navigation' });
    expect(screen.queryByTestId('staged-bar')).toBeNull();
    await fireEvent.press(screen.getByLabelText('Dynamic model: Pedestrian'));
    expect(useConfigStore.getState().staged.get(KEY.NAVSPG_DYNMODEL)).toBe(3);
    expect(screen.getAllByText('Automotive')).toHaveLength(2); // the chip and the old value, struck through
    expect(screen.getByText('→ Pedestrian')).toBeTruthy();
    expect(screen.getByText('1 change')).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: 'Increase Minimum elevation' }));
    expect(useConfigStore.getState().staged.get(KEY.NAVSPG_INFIL_MINELEV)).toBe(
      BE122.get(KEY.NAVSPG_INFIL_MINELEV)! + 1,
    );
    const apply = jest.fn(async () => undefined);
    useConfigStore.setState({ apply });
    const alert = jest.spyOn(Alert, 'alert');
    await fireEvent.press(screen.getByRole('button', { name: 'Apply' }));
    expect(alert.mock.calls[0][0]).toBe('Apply 2 changes?');
    await act(async () => alert.mock.calls[0][2]![1].onPress!());
    expect(apply).toHaveBeenCalled();
    alert.mockRestore();

    await fireEvent.press(screen.getByRole('button', { name: 'Discard' }));
    expect(useConfigStore.getState().staged.size).toBe(0);
  });

  it('locks UBX for the connected port and blocks Apply on rule errors (REQ-CFG-10)', async () => {
    connectedReceiver();
    await renderRouter(APP, { initialUrl: '/config/port' });
    expect(screen.getByLabelText('Input: UBX').props.disabled).toBe(true);
    expect(screen.getAllByText('UBX Mobile needs UBX to talk to the receiver')).toHaveLength(2);

    await act(async () => useConfigStore.getState().stage(KEY.UART1OUTPROT_UBX, 0));
    expect(
      screen.getByText(
        'UBX output must stay on for this port: UBX Mobile needs it to talk to the receiver.',
      ),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Apply' }).props.accessibilityState).toMatchObject({
      disabled: true,
    });
  });

  it('hides settings the receiver does not report', async () => {
    connectedReceiver();
    useConfigStore.setState({ ram: new Map([[KEY.SIGNAL_GPS_ENA, 1]]) });
    await renderRouter(APP, { initialUrl: '/config/gnss' });
    expect(screen.getByText('GPS')).toBeTruthy();
    expect(screen.queryByText('Galileo')).toBeNull();
    expect(screen.getByText(/Applying restarts the GNSS subsystem/)).toBeTruthy();
  });
});
