import { act, fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';

import { stopSource } from '@/sources';
import { emptySnapshot, useGnssStore } from '@/state/gnssStore';
import { GnssAccumulator } from '@/state/GnssAccumulator';
import { useSettings } from '@/state/settingsStore';

import { demoSnapshot } from '../../test/helpers/demo';

const APP = './src/app';

// Rendering the full router is slow on CI and under coverage.
jest.setTimeout(20_000);

/** A phone-source snapshot as the Android source would build it. */
function phoneSnapshot() {
  let t = 0;
  const acc = new GnssAccumulator({ satelliteTimeoutMs: 60_000, now: () => t });
  acc.start('android');
  acc.applyAll([
    {
      t: 'android',
      patch: {
        manufacturer: 'samsung',
        model: 'SM-A536E',
        androidRelease: '14',
        sdkInt: 34,
        fingerprint: 'samsung/a53x',
        hasGnssFeature: true,
        gnssHardwareModelName: 'BCM4775 MSG',
        capabilities: { measurements: true },
        observed: {
          constellations: ['GPS'],
          bands: ['L1', 'L5'],
          dualFrequency: true,
          nmeaOutput: true,
          maxSvUsed: 9,
        },
        locationUpdates: 3,
        statusUpdates: 4,
      },
    },
    { t: 'connection', state: { kind: 'receiving' } },
  ]);
  t = 1;
  return acc.snapshot();
}

function withDemoData() {
  useGnssStore.setState(demoSnapshot(), true);
}

beforeEach(() => {
  useSettings.getState().reset();
  useGnssStore.setState(emptySnapshot(), true);
});

describe('data states (functional spec §1.1)', () => {
  it('asks for a receiver when no source is selected and opens the receiver sheet', async () => {
    const router = await renderRouter(APP, { initialUrl: '/satellites' });
    expect(screen.getByText('Choose a GNSS receiver')).toBeTruthy();
    expect(screen.getByText('No receiver')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Choose receiver' }));
    expect(router.getPathname()).toBe('/source');
    expect(screen.getByTestId('source-sheet')).toBeTruthy();
  });

  it('shows a spinner while connecting and a banner when disconnected', async () => {
    useGnssStore.setState(
      { ...emptySnapshot(), source: 'replay', connection: { kind: 'detecting' } },
      true,
    );
    await renderRouter(APP, { initialUrl: '/status' });
    expect(screen.getByText('Waiting for data from Demo…')).toBeTruthy();

    await act(async () => {
      useGnssStore.setState(
        { ...demoSnapshot(), connection: { kind: 'disconnected', atMs: 0 }, stale: true },
        true,
      );
    });
    expect(screen.getByText('Disconnected — showing last data')).toBeTruthy();
    expect(screen.getByText('Demo · Disconnected')).toBeTruthy();
  });
});

describe('Satellites screen (REQ-SAT)', () => {
  it('lists satellites with summary, flags and the header chip', async () => {
    withDemoData();
    await renderRouter(APP, { initialUrl: '/satellites' });
    expect(screen.getByText('Demo · 3D FIX')).toBeTruthy();
    expect(screen.getByTestId('satellite-summary').props.children).toMatch(
      /^Used \d+ · Signal \d+ · View 22$/,
    );
    const row = screen.getByTestId('sat-row-GPS:5');
    expect(within(row).getByText('G5')).toBeTruthy();
    expect(within(row).getByText('EAU')).toBeTruthy();
    // Unhealthy Galileo satellite is announced to screen readers. (The Jest list renders about
    // nine rows, so narrow the list first.)
    await fireEvent.press(screen.getByTestId('filter-GALILEO'));
    expect(screen.getByTestId('sat-row-GALILEO:27').props.accessibilityLabel).toMatch(/unhealthy/);
  });

  it('filters by constellation and toggles, shared through settings (REQ-SAT-07)', async () => {
    withDemoData();
    await renderRouter(APP, { initialUrl: '/satellites' });
    await fireEvent.press(screen.getByTestId('filter-GALILEO'));
    expect(useSettings.getState().satelliteFilter.constellations).toEqual(['GALILEO']);
    expect(screen.queryByTestId('sat-row-GPS:5')).toBeNull();
    expect(screen.getByTestId('sat-row-GALILEO:4')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('filter-used'));
    expect(screen.queryByTestId('sat-row-GALILEO:27')).toBeNull();
    await fireEvent.press(screen.getByTestId('filter-all'));
    expect(useSettings.getState().satelliteFilter.constellations).toEqual([]);
  });

  it('sorts by tapping column headers (REQ-SAT-06) and switches label style', async () => {
    withDemoData();
    await renderRouter(APP, { initialUrl: '/satellites' });
    await fireEvent.press(screen.getByTestId('sort-cn0'));
    expect(useSettings.getState().satelliteSort).toBe('cn0');
    expect(screen.getByTestId('sort-cn0').props.accessibilityState).toEqual({ selected: true });
    await act(async () => useSettings.getState().update({ svLabelStyle: 'rinex' }));
    expect(screen.getByText('J02')).toBeTruthy();
  });

  it('opens the satellite detail with NAV-SAT fields and signals (REQ-SAT-04)', async () => {
    withDemoData();
    const router = await renderRouter(APP, { initialUrl: '/satellites' });
    await fireEvent.press(screen.getByTestId('filter-BEIDOU'));
    await fireEvent.press(screen.getByTestId('sat-row-BEIDOU:6'));
    expect(router.getPathname()).toBe('/satellite/BEIDOU:6');
    const detail = screen.getByTestId('satellite-detail');
    expect(within(detail).getByText('B6  BeiDou 6')).toBeTruthy();
    expect(within(detail).getByLabelText('Ephemeris: Yes')).toBeTruthy();
    expect(within(detail).getByLabelText('Orbit source: Ephemeris')).toBeTruthy();
    expect(within(detail).getByText('B1I D1')).toBeTruthy();
    expect(within(detail).getByText('B1C')).toBeTruthy();
    expect(within(detail).getByText('UBX-NAV-SAT')).toBeTruthy();
  });

  it('shows a message when a detail satellite disappears', async () => {
    withDemoData();
    await renderRouter(APP, { initialUrl: '/satellite/GPS:99' });
    expect(screen.getByText('This satellite is no longer reported.')).toBeTruthy();
  });
});

describe('Sky screen (REQ-SKY)', () => {
  it('draws the plot, gauge and legend and notes satellites without position', async () => {
    withDemoData();
    await renderRouter(APP, { initialUrl: '/sky' });
    expect(screen.getByTestId('sky-plot').props.accessibilityLabel).toMatch(
      /^Sky plot with \d+ satellites$/,
    );
    expect(screen.getByTestId('cn0-gauge').props.accessibilityLabel).toMatch(
      /Avg C\/N0: In view \d+\.\d, Used \d+\.\d dB-Hz/,
    );
    expect(screen.getByText('1 satellites without a known position are not shown.')).toBeTruthy();
    expect(screen.getByText('Legend')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Legend' }));
    expect(screen.queryByText('Used in fix')).toBeNull();
  });
});

describe('Status screen (REQ-POS-01)', () => {
  it('shows fix, position, DOP, time and TTFF', async () => {
    withDemoData();
    await renderRouter(APP, { initialUrl: '/status' });
    expect(screen.getByText('3D FIX', { exact: true })).toBeTruthy();
    expect(screen.getByText('TTFF 3.2 s')).toBeTruthy();
    expect(screen.getByLabelText(/^Latitude: 1\.35208\d{2}° N$/)).toBeTruthy();
    expect(screen.getByLabelText(/^PDOP \d\.\d\d$/)).toBeTruthy();
    expect(screen.getByLabelText(/^UTC: 2026-10-18 11:39:09\.000$/)).toBeTruthy();
  });
});

describe('Device screen (REQ-DEV)', () => {
  it('shows receiver identity, antenna and stream statistics', async () => {
    withDemoData();
    await renderRouter(APP, { initialUrl: '/device' });
    expect(screen.getByLabelText('Module: —')).toBeTruthy(); // the BE-122 reports no MOD=
    expect(screen.getByLabelText('Firmware: SPG 5.10')).toBeTruthy();
    expect(screen.getByLabelText('Protocol version: 34.10')).toBeTruthy();
    expect(screen.getByLabelText('Unique chip ID: 9A3C5107E2')).toBeTruthy();
    expect(screen.getByLabelText('Antenna status: OK')).toBeTruthy();
    expect(screen.getByLabelText('NMEA version: 4.10+')).toBeTruthy();
    expect(screen.getByText('u-blox AG - www.u-blox.com')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Share device info' })).toBeTruthy();
  });

  it('shows phone details for the phone source (REQ-DEV-02)', async () => {
    useGnssStore.setState(phoneSnapshot(), true);
    await renderRouter(APP, { initialUrl: '/device' });
    expect(screen.getByLabelText('Model: SM-A536E')).toBeTruthy();
    expect(screen.getByLabelText('Android: 14 (API 34)')).toBeTruthy();
    expect(screen.getByLabelText('Hardware model: BCM4775 MSG')).toBeTruthy();
    expect(screen.getByLabelText('Year of hardware: Not reported by device')).toBeTruthy();
    expect(screen.getByLabelText('Raw measurements: Yes')).toBeTruthy();
    expect(screen.getByLabelText('Dual-frequency: Yes')).toBeTruthy();
    expect(screen.getByLabelText('Signal bands: L1, L5')).toBeTruthy();
    expect(screen.queryByText('Receiver')).toBeNull();
  });
});

describe('Device screen for USB receivers (REQ-DEV-03)', () => {
  it('describes the USB adapter separately from the GNSS module', async () => {
    const snap = demoSnapshot();
    useGnssStore.setState(
      {
        ...snap,
        source: 'usb',
        device: {
          ...snap.device,
          usb: {
            vendorId: 0x10c4,
            productId: 0xea60,
            productName: 'CP2102 USB to UART Bridge Controller',
            manufacturerName: 'Silicon Labs',
            deviceName: '/dev/bus/usb/001/002',
            driver: 'cp210x',
            portIndex: 0,
            baud: 57600,
          },
        },
      },
      true,
    );
    await renderRouter(APP, { initialUrl: '/device' });
    expect(screen.getByText('USB adapter')).toBeTruthy();
    expect(screen.getByText(/This is the USB-to-serial adapter/)).toBeTruthy();
    expect(screen.getByLabelText('VID:PID: 10C4:EA60')).toBeTruthy();
    expect(screen.getByLabelText('Baud rate: 57600')).toBeTruthy();
    expect(screen.getByLabelText('Firmware: SPG 5.10')).toBeTruthy();
  });
});

describe('error banners (functional spec §10)', () => {
  it.each([
    ['E_PROVIDER_DISABLED', 'Turn on location'],
    ['E_PERMISSION', 'Allow location'],
    ['E_IO', 'Retry'],
  ] as const)('offers the right action for %s', async (code, action) => {
    useGnssStore.setState(
      { ...phoneSnapshot(), connection: { kind: 'error', code, message: 'Something is wrong.' } },
      true,
    );
    await renderRouter(APP, { initialUrl: '/status' });
    expect(screen.getByText('Something is wrong.')).toBeTruthy();
    expect(screen.getByRole('button', { name: action })).toBeTruthy();
    expect(screen.getByText('Phone · Error')).toBeTruthy();
  });
});

describe('Receiver sheet (functional spec §2)', () => {
  afterEach(async () => {
    await act(async () => stopSource());
  });

  it('starts the demo receiver, remembers it and disconnects', async () => {
    // Real timers: the replay publishes its first epoch as soon as it starts.
    await renderRouter(APP, { initialUrl: '/source' });
    expect(screen.getByTestId('source-phone').props.accessibilityState).toMatchObject({
      disabled: false,
    });
    expect(screen.getByTestId('source-usb').props.accessibilityState).toMatchObject({
      disabled: true,
    });
    await fireEvent.press(screen.getByTestId('source-demo'));
    // Building the 3-minute demo log can take a while under coverage instrumentation.
    await waitFor(() => expect(useGnssStore.getState().source).toBe('replay'), { timeout: 10_000 });
    expect(useSettings.getState().lastSource).toBe('demo');

    await act(async () => stopSource());
    expect(useGnssStore.getState().source).toBeNull();
    expect(useSettings.getState().lastSource).toBeUndefined();
  });
});
