import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';

import { ProtocolPipeline } from '@/protocols/pipeline';
import { CONSOLE_REFRESH_MS, recordConsole, resetConsole, useConsole } from '@/state/consoleStore';
import { emptySnapshot, useGnssStore } from '@/state/gnssStore';

import { concat, navPvt, nmea } from '../../test/helpers/fixtures';

const APP = './src/app';
jest.setTimeout(20_000);

/** Feeds bytes through the real pipeline into the Console and waits for the refresh. */
async function receive(bytes: Uint8Array) {
  await act(async () => {
    for (const e of new ProtocolPipeline().push(bytes, 0).events) {
      if (e.t === 'console') recordConsole(e.entries);
    }
    jest.advanceTimersByTime(CONSOLE_REFRESH_MS); // fake timers (jest-expo default)
  });
}

beforeEach(() => {
  resetConsole();
  useGnssStore.setState(emptySnapshot(), true);
});

describe('Console screen (REQ-LOG-01, functional spec §8)', () => {
  it('shows the stream and decodes a UBX message on tap', async () => {
    await renderRouter(APP, { initialUrl: '/console' });
    expect(screen.getByText(/No messages yet/)).toBeTruthy();

    await receive(concat(nmea('GNGGA,113902.00,0121.12500,N'), navPvt({ numSV: 9 })));
    expect(screen.getByText(/^\$GNGGA,113902\.00,0121\.12500,N\*/)).toBeTruthy();
    const ubx = screen.getByText('UBX-NAV-PVT (92 B)');
    await fireEvent.press(ubx);
    expect(screen.getByText('Decoded')).toBeTruthy();
    expect(screen.getByText(/"numSvUsed": 9/)).toBeTruthy();
    expect(screen.getByText('Payload (92 bytes)')).toBeTruthy();
  });

  it('pauses, filters and clears', async () => {
    await renderRouter(APP, { initialUrl: '/console' });
    await receive(concat(nmea('GNRMC,1'), navPvt()));

    await fireEvent.press(screen.getByRole('button', { name: 'Pause' }));
    await receive(nmea('GNGGA,2'));
    expect(screen.getByText('Paused — 1 new messages')).toBeTruthy();
    expect(screen.queryByText(/^\$GNGGA,2/)).toBeNull();
    await fireEvent.press(screen.getAllByRole('button', { name: 'Resume' })[0]);
    expect(screen.getByText(/^\$GNGGA,2/)).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: 'Filter' }));
    await fireEvent.press(screen.getByRole('checkbox', { name: 'UBX' }));
    expect(screen.queryByText(/^\$GNRMC/)).toBeNull();
    expect(screen.getByText('UBX-NAV-PVT (92 B)')).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: 'Clear' }));
    expect(useConsole.getState().entries).toEqual([]);
    expect(screen.getByText(/No messages yet/)).toBeTruthy();
  });
});
