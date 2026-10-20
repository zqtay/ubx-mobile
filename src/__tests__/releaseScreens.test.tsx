import { fireEvent, renderRouter, screen } from 'expo-router/testing-library';
import { Share } from 'react-native';

import { licenses, licenseTexts } from '@/legal';
import { sourceManager } from '@/sources';
import { diagnosticsReport, logDiagnostic, useDiagnostics } from '@/state/diagnostics';

jest.setTimeout(20_000);

beforeEach(() => useDiagnostics.getState().clear());

describe('open-source licences (M7.4)', () => {
  it('lists every shipped component with a known licence', () => {
    expect(licenses.length).toBeGreaterThan(40);
    expect(licenses.every((l) => l.license && l.license !== 'UNKNOWN')).toBe(true);
    for (const name of ['react-native', 'expo', 'zustand', 'usb-serial-for-android']) {
      expect(licenses.some((l) => l.name === name)).toBe(true);
    }
    expect(licenses.filter((l) => l.text !== undefined).every((l) => licenseTexts[l.text!])).toBe(
      true,
    );
  });

  it('opens a licence from About', async () => {
    const router = await renderRouter('./src/app', { initialUrl: '/about' });
    await fireEvent.press(screen.getByRole('button', { name: /^Open-source licences/ }));
    expect(router.getPathname()).toBe('/licenses');
    expect(screen.getByText(/© OpenStreetMap contributors/)).toBeTruthy();
    const index = licenses.findIndex((l) => l.name === 'zustand');
    await fireEvent.press(screen.getByRole('button', { name: new RegExp(`^zustand `) }));
    expect(router.getPathname()).toBe(`/licenses/${index}`);
    expect(screen.getByText(/Permission is hereby granted/)).toBeTruthy();
  });
});

describe('diagnostics log (REQ-LOG-03)', () => {
  it('records source errors and is shared from About', async () => {
    logDiagnostic({ level: 'info', area: 'config', message: 'apply: ok', details: 'x=1' });
    const share = jest
      .spyOn(Share, 'share')
      .mockResolvedValue({ action: 'sharedAction', activityType: undefined });
    await renderRouter('./src/app', { initialUrl: '/about' });
    expect(screen.getByText(/^1 entry:/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Share log' }));
    expect(share.mock.calls[0][0].message).toMatch(
      // Jest has no app version (expoConfig), so only the shape of the header is checked.
      /^UBX Mobile .*\n\n\S+Z INFO {4}\[config\] apply: ok\n {4}x=1$/,
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Clear' }));
    expect(useDiagnostics.getState().entries).toEqual([]);
    share.mockRestore();
  });

  it('logs source start, connection errors and decode errors (rate-limited)', async () => {
    const emits: ((e: never) => void)[] = [];
    const fake = {
      kind: 'usb' as const,
      label: 'Fake',
      start: async (emit: (e: never) => void) => void emits.push(emit),
      stop: async () => undefined,
    };
    await sourceManager.start(fake as never);
    const emit = emits[0] as (e: unknown) => void;
    emit({ t: 'connection', state: { kind: 'error', code: 'E_USB_OPEN', message: 'busy' } });
    const stats = (n: number) => ({
      t: 'stats',
      stats: {
        bytes: 0,
        nmeaFrames: 0,
        ubxFrames: 0,
        rtcmFrames: 0,
        nmeaChecksumErrors: n,
        nmeaNoChecksum: 0,
        ubxChecksumErrors: 0,
        rtcmCrcErrors: 0,
        junkBytes: 0,
      },
    });
    emit(stats(3));
    emit(stats(5)); // within 10 s: not logged again
    await sourceManager.stop();
    expect(
      useDiagnostics.getState().entries.map((e) => `${e.level} ${e.area} ${e.message}`),
    ).toEqual([
      'info source Started: Fake',
      'error source E_USB_OPEN: busy',
      'warning decoder 3 new checksum/CRC errors (total NMEA 3, UBX 0, RTCM 0)',
    ]);
    expect(diagnosticsReport([], 'H')).toBe('H\n');
  });
});

describe('help (M7.4)', () => {
  it('explains OTG, wiring, power and baud rate', async () => {
    const router = await renderRouter('./src/app', { initialUrl: '/more' });
    await fireEvent.press(screen.getByRole('button', { name: /^Help/ }));
    expect(router.getPathname()).toBe('/help');
    for (const title of [
      'Connecting a USB receiver',
      'Modules with a serial (TTL) port',
      'Power',
      'Baud rate',
      'No data?',
    ]) {
      expect(screen.getByText(title)).toBeTruthy();
    }
    expect(screen.getByText(/adapter RX → module TX/)).toBeTruthy();
  });
});
