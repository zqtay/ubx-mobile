import { act, fireEvent, renderRouter, screen, within } from 'expo-router/testing-library';
import { Dimensions } from 'react-native';

import { ProtocolPipeline } from '@/protocols/pipeline';
import { CONSOLE_REFRESH_MS, recordConsole, resetConsole, useConsole } from '@/state/consoleStore';
import { emptySnapshot, useGnssStore } from '@/state/gnssStore';
import { consoleDateTime, nmeaParts, nmeaTime, ubxItow } from '@/ui/console/decode';

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

const setWindow = (width: number, height: number) =>
  Dimensions.set({
    window: { width, height, scale: 3, fontScale: 1 },
    screen: { width, height, scale: 3, fontScale: 1 },
  });

beforeEach(() => {
  resetConsole();
  useGnssStore.setState(emptySnapshot(), true);
});
afterEach(() => setWindow(390, 844));

describe('Console screen (REQ-LOG-01, functional spec §8)', () => {
  it('shows the selected message in the detail panel instead of expanding rows', async () => {
    await renderRouter(APP, { initialUrl: '/console' });
    expect(screen.getByTestId('console-portrait')).toBeTruthy();
    expect(screen.getByText(/No messages yet/)).toBeTruthy();
    expect(screen.getByText('Tap a message to see its details.')).toBeTruthy();

    await receive(concat(nmea('GNGGA,113902.00,0121.12500,N,,1'), navPvt({ numSV: 9 })));
    const list = screen.getByTestId('console-list');
    await fireEvent.press(within(list).getByText('UBX-NAV-PVT (92 B)'));
    const detail = screen.getByTestId('console-detail');
    expect(within(detail).getByText('UBX-NAV-PVT')).toBeTruthy();
    expect(within(detail).getByText('UBX · 0x01 0x07 · 92 bytes')).toBeTruthy();
    expect(within(detail).getByText(/"numSvUsed": 9/)).toBeTruthy();
    expect(within(detail).getByText('Payload (92 bytes)')).toBeTruthy();
    expect(within(detail).getByTestId('console-received')).toBeTruthy();
    expect(within(detail).getByText(/^\d{4}-\d{2}-\d{2} \d\d:\d\d:\d\d\.\d{3}$/)).toBeTruthy();
    expect(
      within(detail).getByText(/^\w{3} \d\d:\d\d:\d\d\.\d{3} GPS \(iTOW \d+ ms\)$/),
    ).toBeTruthy();
    // The list row did not grow a detail section.
    expect(within(list).queryByText('Decoded')).toBeNull();

    await fireEvent.press(within(list).getByText(/^\$GNGGA,113902\.00/));
    const nmeaDetail = screen.getByTestId('console-detail');
    expect(
      within(nmeaDetail).getByText(/^Talker GN · Sentence GGA · Checksum [0-9A-F]{2}$/),
    ).toBeTruthy();
    expect(within(nmeaDetail).getByText('0121.12500')).toBeTruthy();
    expect(within(nmeaDetail).getByText('11:39:02.00 UTC')).toBeTruthy();
    expect(within(nmeaDetail).getAllByText('—').length).toBeGreaterThan(0); // empty fields

    // Clear also removes the selection.
    await fireEvent.press(screen.getByRole('button', { name: 'Clear' }));
    expect(useConsole.getState().entries).toEqual([]);
    expect(screen.getByText('Tap a message to see its details.')).toBeTruthy();
  });

  it('stops following while a message is selected', async () => {
    await renderRouter(APP, { initialUrl: '/console' });
    await receive(nmea('GNRMC,1'));
    await fireEvent.press(screen.getByText(/^\$GNRMC,1/));
    expect(screen.queryByText('↓ New messages')).toBeNull();
    await receive(nmea('GNGGA,2'));
    // The new message is listed, but the list does not jump to it: the pill offers to follow.
    expect(within(screen.getByTestId('console-list')).getByText(/^\$GNGGA,2/)).toBeTruthy();
    expect(screen.getByText('↓ New messages')).toBeTruthy();
    await fireEvent.press(screen.getByText('↓ New messages'));
    expect(screen.getByText('Tap a message to see its details.')).toBeTruthy();
    expect(screen.queryByText('↓ New messages')).toBeNull();

    // Tapping the selected message again clears the selection.
    const row = () => within(screen.getByTestId('console-list')).getByText(/^\$GNGGA,2/);
    await fireEvent.press(row());
    expect(screen.getByTestId('console-detail')).toBeTruthy();
    await fireEvent.press(row());
    expect(screen.getByText('Tap a message to see its details.')).toBeTruthy();
  });

  it('puts list and panel side by side in landscape', async () => {
    setWindow(844, 390);
    await renderRouter(APP, { initialUrl: '/console' });
    expect(screen.getByTestId('console-landscape')).toBeTruthy();
    expect(screen.getByTestId('console-panel')).toBeTruthy();
  });

  it('resizes the panes with the divider, within limits', async () => {
    await renderRouter(APP, { initialUrl: '/console' });
    await act(async () => {
      fireEvent(screen.getByTestId('console-split'), 'layout', {
        nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 720 } },
      });
    });
    const pane = () => screen.getByTestId('console-list-pane').props.style;
    expect(pane()).toEqual({ height: Math.round(700 * 0.55) }); // 720 − 20 dp divider
    const divider = screen.getByTestId('console-divider');
    const at = (pageY: number) => ({ nativeEvent: { pageX: 0, pageY } });
    await act(async () => {
      divider.props.onResponderGrant(at(400));
      divider.props.onResponderMove(at(260)); // drag up 140 dp = 20 %
      divider.props.onResponderRelease(at(260));
    });
    expect(pane()).toEqual({ height: Math.round(700 * 0.35) });
    await act(async () => {
      divider.props.onResponderGrant(at(100));
      divider.props.onResponderMove(at(-500));
    });
    expect(pane()).toEqual({ height: Math.round(700 * 0.2) }); // minimum
  });

  it('keeps the controls on one line, dropping labels when narrow', async () => {
    await renderRouter(APP, { initialUrl: '/console' });
    const controls = screen.getByTestId('console-controls');
    const layout = async (width: number) =>
      act(async () => {
        fireEvent(controls, 'layout', {
          nativeEvent: { layout: { x: 0, y: 0, width, height: 36 } },
        });
      });
    await layout(380);
    expect(within(controls).getByText('Pause')).toBeTruthy();
    await layout(240);
    expect(within(controls).queryByText('Pause')).toBeNull();
    // Still announced to screen readers.
    expect(within(controls).getByRole('button', { name: 'Pause' })).toBeTruthy();
    expect(within(controls).getAllByRole('button')).toHaveLength(4);
  });

  it('pauses and filters from the panel', async () => {
    await renderRouter(APP, { initialUrl: '/console' });
    await receive(concat(nmea('GNRMC,1'), navPvt()));

    await fireEvent.press(screen.getByRole('button', { name: 'Pause' }));
    await receive(nmea('GNGGA,2'));
    expect(screen.getByText('Paused — 1 new messages')).toBeTruthy();
    expect(screen.queryByText(/^\$GNGGA,2/)).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Resume' }));
    expect(screen.getByText(/^\$GNGGA,2/)).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: 'Filter' }));
    await fireEvent.press(
      within(screen.getByTestId('console-filter')).getByRole('checkbox', { name: 'UBX' }),
    );
    expect(screen.queryByText(/^\$GNRMC/)).toBeNull();
    expect(screen.getByText('UBX-NAV-PVT (92 B)')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Wrap long lines' }));
  });
});

describe('NMEA detail parsing', () => {
  it('splits talker, sentence, fields and checksum', () => {
    expect(nmeaParts('$GNRMC,113902.00,A,,N*5B')).toEqual({
      talker: 'GN',
      type: 'RMC',
      fields: ['113902.00', 'A', '', 'N'],
      checksum: '5B',
    });
    expect(nmeaParts('$PUBX,00,1*2C')).toMatchObject({ talker: 'P', type: 'UBX' });
    expect(nmeaParts('$GPTXT')).toMatchObject({ fields: [] });
    expect(nmeaParts('garbage')).toBeUndefined();
    expect(nmeaTime(nmeaParts('$GNGLL,0121.1,N,10349.1,E,113902.00,A*00')!)).toBe(
      '11:39:02.00 UTC',
    );
    expect(nmeaTime(nmeaParts('$GNGSV,1,1,00*00')!)).toBeUndefined();
    expect(nmeaTime(nmeaParts('$GNRMC,,V*00')!)).toBeUndefined();
  });

  it('formats receive time and UBX time of week', () => {
    expect(consoleDateTime(new Date(2026, 9, 19, 11, 39, 2, 104).getTime())).toBe(
      '2026-10-19 11:39:02.104',
    );
    const itow = (ms: number) => {
      const p = new Uint8Array(8);
      new DataView(p.buffer).setUint32(0, ms, true);
      return p;
    };
    expect(ubxItow(0x01, itow(86_400_000 + 41_960_250))).toBe(
      'Mon 11:39:20.250 GPS (iTOW 128360250 ms)',
    );
    expect(ubxItow(0x0a, itow(1000))).toBeUndefined(); // not a NAV message
    expect(ubxItow(0x01, new Uint8Array(2))).toBeUndefined();
  });
});
