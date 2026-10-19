import { consoleEntries, ProtocolPipeline } from '@/protocols/pipeline';
import {
  CONSOLE_REFRESH_MS,
  filterConsole,
  MAX_CONSOLE_ENTRIES,
  recordConsole,
  resetConsole,
  useConsole,
} from '@/state/consoleStore';
import { consoleTime, decodeUbx, hexDump } from '@/ui/console/decode';

import { concat, navPvt, nmea, rtcm1005 } from '../../../test/helpers/fixtures';

const line = (text: string) => ({ kind: 'nmea' as const, name: text.slice(1, 6), text });

describe('console store (REQ-LOG-01, functional spec §8)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    resetConsole();
  });
  afterEach(() => jest.useRealTimers());

  it('publishes entries at most every refresh interval', () => {
    recordConsole([line('$GNRMC,1'), line('$GNGGA,1')], 1000);
    expect(useConsole.getState().entries).toEqual([]);
    jest.advanceTimersByTime(CONSOLE_REFRESH_MS);
    const { entries, names } = useConsole.getState();
    expect(entries.map((e) => [e.id, e.text, e.atMs])).toEqual([
      [expect.any(Number), '$GNRMC,1', 1000],
      [expect.any(Number), '$GNGGA,1', 1000],
    ]);
    expect(entries[1].id).toBeGreaterThan(entries[0].id);
    expect(names).toEqual(['GNGGA', 'GNRMC']);
  });

  it('keeps the newest 2000 entries', () => {
    for (let i = 0; i < 3000; i++) recordConsole([line(`$GNGGA,${i}`)]);
    jest.advanceTimersByTime(CONSOLE_REFRESH_MS);
    const entries = useConsole.getState().entries;
    expect(entries).toHaveLength(MAX_CONSOLE_ENTRIES);
    expect(entries.at(-1)?.text).toBe('$GNGGA,2999');
    expect(entries[0].text).toBe('$GNGGA,1000');
  });

  it('freezes the list while paused, counts what arrives and clears', () => {
    recordConsole([line('$GNRMC,1')]);
    jest.advanceTimersByTime(CONSOLE_REFRESH_MS);
    useConsole.getState().setPaused(true);
    recordConsole([line('$GNRMC,2'), line('$GNRMC,3')]);
    jest.advanceTimersByTime(CONSOLE_REFRESH_MS);
    expect(useConsole.getState()).toMatchObject({ missed: 2 });
    expect(useConsole.getState().entries).toHaveLength(1);
    useConsole.getState().setPaused(false);
    expect(useConsole.getState().entries).toHaveLength(3);
    useConsole.getState().clear();
    expect(useConsole.getState().entries).toEqual([]);
  });

  it('filters by kind and name (empty = all)', () => {
    recordConsole([
      line('$GNRMC,1'),
      { kind: 'ubx', name: 'UBX-NAV-PVT', text: 'UBX-NAV-PVT (92 B)' },
      { kind: 'error', name: 'NMEA checksum error', text: 'NMEA checksum error' },
    ]);
    jest.advanceTimersByTime(CONSOLE_REFRESH_MS);
    const all = useConsole.getState().entries;
    expect(filterConsole(all, new Set(), new Set())).toHaveLength(3);
    expect(filterConsole(all, new Set(['ubx', 'error']), new Set()).map((e) => e.kind)).toEqual([
      'ubx',
      'error',
    ]);
    expect(filterConsole(all, new Set(), new Set(['GNRMC'])).map((e) => e.name)).toEqual(['GNRMC']);
  });
});

describe('console entries from the protocol pipeline', () => {
  it('lists NMEA, UBX and RTCM frames and checksum errors', () => {
    const corrupt = nmea('GNGGA,1');
    corrupt[corrupt.length - 3] ^= 0x01; // break the checksum
    const { events } = new ProtocolPipeline().push(
      concat(nmea('GNRMC,113902.00,A'), navPvt(), rtcm1005(), corrupt),
      0,
    );
    const console = events.find((e) => e.t === 'console');
    expect(
      console?.t === 'console' && console.entries.map(({ kind, name, text }) => [kind, name, text]),
    ).toEqual([
      ['nmea', 'GNRMC', expect.stringMatching(/^\$GNRMC,113902\.00,A\*[0-9A-F]{2}$/)],
      ['ubx', 'UBX-NAV-PVT', 'UBX-NAV-PVT (92 B)'],
      ['rtcm', 'RTCM3 1005', expect.stringMatching(/^RTCM3 1005 \(\d+ B\)$/)],
      ['error', 'NMEA checksum error', 'NMEA checksum error'],
    ]);
    expect(
      consoleEntries(
        [],
        { nmeaChecksumErrors: 0, ubxChecksumErrors: 0, rtcmCrcErrors: 0 },
        { nmeaChecksumErrors: 0, ubxChecksumErrors: 1, rtcmCrcErrors: 1 },
      ).map((e) => e.text),
    ).toEqual(['UBX checksum error', 'RTCM3 CRC error']);
  });
});

describe('console UBX detail', () => {
  it('decodes known messages, dumps the payload and formats the time', () => {
    const frame = navPvt({ numSV: 9 });
    const payload = frame.subarray(6, frame.length - 2);
    expect(decodeUbx(0x01, 0x07, payload)).toMatch(/"numSvUsed": 9/);
    expect(decodeUbx(0x0a, 0x7f, payload)).toBeUndefined();
    const dump = hexDump(Uint8Array.from({ length: 20 }, (_, i) => i));
    expect(dump.split('\n')).toEqual([
      '0000  00 01 02 03 04 05 06 07 08 09 0A 0B 0C 0D 0E 0F',
      '0010  10 11 12 13',
    ]);
    expect(consoleTime(new Date(2026, 9, 19, 11, 39, 2, 104).getTime())).toBe('11:39:02.104');
  });
});
