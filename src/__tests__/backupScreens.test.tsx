import * as Clipboard from 'expo-clipboard';
import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';
import { Share } from 'react-native';

import { backupId, createBackup, listBackups, storeBackup } from '@/config/backups';
import { KEY } from '@/config/keys';
import { useConfigStore } from '@/sources';
import { emptySnapshot, useGnssStore } from '@/state/gnssStore';
import { storage } from '@/state/storage';

import { BE122_DUMP } from '../../test/fixtures/m10Dumps';
import { dumpRamValues } from '../../test/helpers/configSim';
import { demoSnapshot } from '../../test/helpers/demo';

jest.mock('expo-clipboard', () => ({
  getStringAsync: jest.fn(),
  setStringAsync: jest.fn(),
}));

jest.setTimeout(20_000);
const BE122 = dumpRamValues(BE122_DUMP);
const initial = useConfigStore.getState();

function connected() {
  useGnssStore.setState(
    { ...demoSnapshot(), source: 'usb', connection: { kind: 'receiving' } },
    true,
  );
  useConfigStore.setState({
    ...initial,
    status: 'ready',
    port: 'UART1',
    baud: 57600,
    ram: new Map(BE122),
    def: new Map(BE122),
    staged: new Map(),
    readCurrent: async (keys) =>
      new Map(keys.filter((k) => BE122.has(k)).map((k) => [k, BE122.get(k)!])),
  });
}

const sample = () =>
  createBackup(
    'manual',
    { module: 'BE-122' },
    {
      ram: [
        { key: KEY.RATE_MEAS, value: 1000 },
        { key: KEY.NAVSPG_DYNMODEL, value: BE122.get(KEY.NAVSPG_DYNMODEL)! },
        { key: 0x10ff0001, value: 1 },
      ],
    },
    Date.UTC(2026, 9, 19, 12, 3),
  );

beforeEach(() => {
  storage.clearAll();
  useGnssStore.setState(emptySnapshot(), true);
  useConfigStore.setState({ ...initial }, true);
});

describe('backup & restore screens (REQ-CFG-16)', () => {
  it('lists backups, shares them as JSON and imports from the clipboard', async () => {
    connected();
    const b = sample();
    storeBackup(b);
    const share = jest
      .spyOn(Share, 'share')
      .mockResolvedValue({ action: 'sharedAction', activityType: undefined });
    const router = await renderRouter('./src/app', { initialUrl: '/config/backups' });
    expect(screen.getByText(/^Backup · /)).toBeTruthy();
    expect(screen.getByText('BE-122 · 3 keys')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Share' }));
    expect(JSON.parse(share.mock.calls[0][0].message!)).toEqual(b);

    jest.mocked(Clipboard.getStringAsync).mockResolvedValue('not a backup');
    await fireEvent.press(screen.getByRole('button', { name: 'Paste backup from clipboard' }));
    expect(screen.getByText(/does not contain a UBX Mobile configuration backup/)).toBeTruthy();

    const other = { ...b, createdAt: '2026-10-19T13:00:00.000Z' };
    jest.mocked(Clipboard.getStringAsync).mockResolvedValue(JSON.stringify(other));
    await fireEvent.press(screen.getByRole('button', { name: 'Paste backup from clipboard' }));
    expect(listBackups().map((x) => x.kind)).toEqual(['manual', 'imported']);
    expect(router.getPathname()).toBe('/config/restore');
    share.mockRestore();
  });

  it('previews the differences and stages them', async () => {
    connected();
    const b = sample();
    storeBackup(b);
    await renderRouter('./src/app', {
      initialUrl: `/config/restore?id=${encodeURIComponent(backupId(b))}`,
    });
    await act(async () => undefined);
    expect(screen.getByTestId('restore-summary').props.children).toBe(
      '1 to change · 1 already the same · 1 not supported (skipped)',
    );
    expect(screen.getByText('Measurement rate: 10 Hz → 1 Hz')).toBeTruthy();
    expect(screen.getByText('0x10FF0001')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Stage 1 change' }));
    expect([...useConfigStore.getState().staged]).toEqual([[KEY.RATE_MEAS, 1000]]);
  });
});
