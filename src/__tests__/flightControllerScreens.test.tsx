import { fireEvent, renderRouter, screen } from 'expo-router/testing-library';
import { Alert } from 'react-native';

import { KEY } from '@/config/keys';
import { confirmPassthrough, useConfigStore } from '@/sources';
import { emptySnapshot, useGnssStore } from '@/state/gnssStore';

import { BE122_DUMP } from '../../test/fixtures/m10Dumps';
import { dumpRamValues } from '../../test/helpers/configSim';
import { demoSnapshot } from '../../test/helpers/demo';

jest.setTimeout(20_000);
const initial = useConfigStore.getState();

function viaFlightController() {
  const demo = demoSnapshot();
  useGnssStore.setState(
    {
      ...demo,
      source: 'usb',
      connection: { kind: 'receiving' },
      device: {
        ...demo.device,
        usb: {
          vendorId: 0x0483,
          productId: 0x5740,
          productName: 'Betaflight STM32F7x2',
          deviceName: '/dev/bus/usb/001/002',
          driver: 'cdc-acm',
          portIndex: 0,
          flightController: {
            name: 'Betaflight',
            version: '4.5.1',
            versionLine: 'Betaflight / STM32F7X2 (S7X2) 4.5.1 Jul 15 2024',
            passthrough: true,
          },
        },
      },
    },
    true,
  );
  const ram = dumpRamValues(BE122_DUMP);
  useConfigStore.setState({
    ...initial,
    status: 'ready',
    port: 'UART1',
    ram,
    def: new Map(ram),
    staged: new Map(),
    viaFlightController: true,
  });
}

afterEach(() => {
  useGnssStore.setState(emptySnapshot(), true);
  useConfigStore.setState({ ...initial }, true);
});

describe('flight controller passthrough UI (FS §2.2)', () => {
  it('asks before enabling passthrough, and Cancel or dismiss means no', async () => {
    const alert = jest.spyOn(Alert, 'alert');
    const info = { variant: 'BTFL', name: 'Betaflight' };
    const yes = confirmPassthrough(info);
    expect(alert.mock.calls[0][0]).toBe('Betaflight flight controller detected');
    expect(alert.mock.calls[0][1]).toMatch(/remove the propellers/);
    alert.mock.calls[0][2]![1].onPress!();
    await expect(yes).resolves.toBe(true);

    const no = confirmPassthrough(info);
    alert.mock.calls[1][2]![0].onPress!();
    await expect(no).resolves.toBe(false);

    const dismissed = confirmPassthrough(info);
    alert.mock.calls[2][3]!.onDismiss!();
    await expect(dismissed).resolves.toBe(false);
    alert.mockRestore();
  });

  it('shows the flight controller and passthrough on the Device screen', async () => {
    viaFlightController();
    await renderRouter('./src/app', { initialUrl: '/device' });
    expect(screen.getByText('Flight controller (USB)')).toBeTruthy();
    expect(screen.getByText('Betaflight / STM32F7X2 (S7X2) 4.5.1 Jul 15 2024')).toBeTruthy();
    expect(screen.getByText('On until the flight controller is power-cycled')).toBeTruthy();
  });

  it('locks the baud rate and warns about GPS auto-config (REQ-SER-18)', async () => {
    viaFlightController();
    await renderRouter('./src/app', { initialUrl: '/config/port' });
    expect(screen.getByText(/The flight controller sets this speed/)).toBeTruthy();
    // Choosing another rate does nothing.
    await fireEvent.press(screen.getByLabelText('Baud rate: 38400'));
    expect(useConfigStore.getState().staged.has(KEY.UART1_BAUDRATE)).toBe(false);

    await renderRouter('./src/app', { initialUrl: '/config' });
    expect(screen.getByText(/Connected through a flight controller/)).toBeTruthy();
  });
});
