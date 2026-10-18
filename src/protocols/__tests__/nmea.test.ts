import type { GnssEvent } from '@/domain/events';

import { SAMPLE_EPOCH_NMEA } from '../../../test/helpers/fixtures';
import { nmeaChecksum, withChecksum } from '../nmea/checksum';
import { NmeaInterpreter } from '../nmea/interpreter';
import { int, num, parseDate, parseLatLon, parseSentence, parseTime } from '../nmea/parser';
import { decodeSentence } from '../nmea/sentences';

const decode = (body: string) => {
  const raw = parseSentence(withChecksum(body));
  if (!raw) throw new Error(`unparseable: ${body}`);
  return decodeSentence(raw);
};

function feed(lines: string[], interpreter = new NmeaInterpreter()): GnssEvent[] {
  const events = lines.flatMap((l, i) => interpreter.pushLine(withChecksum(l), i));
  return [...events, ...interpreter.flush()];
}

const ofType = <T extends GnssEvent['t']>(events: GnssEvent[], t: T) =>
  events.filter((e): e is Extract<GnssEvent, { t: T }> => e.t === t);

describe('NMEA field parsing', () => {
  it('parses coordinates in all hemispheres', () => {
    expect(parseLatLon('0121.12500', 'N')).toBeCloseTo(1.3520833, 6);
    expect(parseLatLon('10349.19000', 'E')).toBeCloseTo(103.8198333, 6);
    expect(parseLatLon('3356.0000', 'S')).toBeCloseTo(-33.9333333, 6);
    expect(parseLatLon('11815.6000', 'W')).toBeCloseTo(-118.26, 6);
    expect(parseLatLon('', 'N')).toBeUndefined();
    expect(parseLatLon('12', 'N')).toBeUndefined();
    expect(parseLatLon('0161.0', 'N')).toBeUndefined();
  });

  it('parses times and dates', () => {
    expect(parseTime('113902.50')).toMatchObject({
      hours: 11,
      minutes: 39,
      seconds: 2.5,
      msOfDay: 41942500,
    });
    expect(parseTime('2561')).toBeUndefined();
    expect(parseTime('256100')).toBeUndefined();
    expect(parseDate('181026')).toEqual({ year: 2026, month: 10, day: 18 });
    expect(parseDate('010199')).toEqual({ year: 1999, month: 1, day: 1 });
    expect(parseDate('321026')).toBeUndefined();
    expect(parseDate('18102')).toBeUndefined();
  });

  it('parses numbers leniently', () => {
    expect(num('1.5')).toBe(1.5);
    expect(num('')).toBeUndefined();
    expect(num('x')).toBeUndefined();
    expect(int('B', 16)).toBe(11);
    expect(int('')).toBeUndefined();
    expect(int('z')).toBeUndefined();
  });

  it('splits sentences and validates checksums', () => {
    const raw = parseSentence(withChecksum('GPGSA,A,3,14,,,,,,,,,,,,1.4,0.8,1.2'));
    expect(raw).toMatchObject({ talker: 'GP', type: 'GSA', checksumOk: true });
    expect(parseSentence('$GPGSA,A,3*00')).toBeUndefined();
    expect(parseSentence('$GPGSA,A,3')?.checksumOk).toBe(false);
    expect(parseSentence('$PUBX,00,1*00')).toBeUndefined();
    expect(parseSentence(withChecksum('PUBX,00,1'))).toMatchObject({ talker: 'P', type: 'UBX' });
    expect(parseSentence('GPGGA,1')).toBeUndefined();
    expect(parseSentence('$G,1,2,3')).toBeUndefined();
    expect(nmeaChecksum('GPGLL')).toBe(0x47 ^ 0x50 ^ 0x47 ^ 0x4c ^ 0x4c);
  });
});

describe('NMEA sentences (REQ-SER-06)', () => {
  it('decodes GGA', () => {
    expect(
      decode('GNGGA,113902.00,0121.12500,N,10349.19000,E,4,12,0.78,32.4,M,7.5,M,1.2,0001'),
    ).toMatchObject({
      type: 'GGA',
      quality: 4,
      numSv: 12,
      hdop: 0.78,
      altMsl: 32.4,
      geoidSep: 7.5,
      diffAge: 1.2,
    });
  });

  it('decodes RMC with mode and nav status', () => {
    expect(
      decode('GNRMC,113902.00,A,0121.12500,N,10349.19000,E,0.025,12.5,181026,,,A,V'),
    ).toMatchObject({
      type: 'RMC',
      status: 'A',
      speedKnots: 0.025,
      courseDeg: 12.5,
      date: { year: 2026, month: 10, day: 18 },
      mode: 'A',
      navStatus: 'V',
    });
  });

  it('decodes GSA with and without system ID', () => {
    expect(decode('GNGSA,A,3,14,17,,,,,,,,,,,1.42,0.78,1.18,1')).toMatchObject({
      navMode: 3,
      svs: [14, 17],
      pdop: 1.42,
      hdop: 0.78,
      vdop: 1.18,
      systemId: 1,
    });
    expect(decode('GPGSA,A,2,05,,,,,,,,,,,,2.0,1.0,1.7')).toMatchObject({
      navMode: 2,
      svs: [5],
      systemId: undefined,
    });
  });

  it('decodes GSV with and without signal ID, and empty fields', () => {
    expect(decode('GPGSV,3,1,11,14,07,312,25,17,34,257,,30,,,21,1')).toMatchObject({
      numMsg: 3,
      msgNum: 1,
      numSv: 11,
      signalId: 1,
      sats: [
        { svid: 14, elevation: 7, azimuth: 312, cn0: 25 },
        { svid: 17, elevation: 34, azimuth: 257, cn0: undefined },
        { svid: 30, elevation: undefined, azimuth: undefined, cn0: 21 },
      ],
    });
    expect(decode('GPGSV,1,1,01,14,07,312,25')).toMatchObject({
      signalId: undefined,
      sats: [{ svid: 14 }],
    });
    expect(decode('GBGSV,1,1,01,21,05,277,24,B')).toMatchObject({ signalId: 11 });
    expect(decode('GPGSV,,1,00')).toBeUndefined();
  });

  it('decodes GLL, VTG, GNS, ZDA and TXT', () => {
    expect(decode('GNGLL,0121.12500,N,10349.19000,E,113902.00,A,A')).toMatchObject({
      type: 'GLL',
      status: 'A',
      mode: 'A',
    });
    expect(decode('GNVTG,45.0,T,,M,1.0,N,1.852,K,A')).toMatchObject({
      courseTrueDeg: 45,
      speedKnots: 1,
      speedKmh: 1.852,
    });
    expect(
      decode('GNGNS,113902.00,0121.12500,N,10349.19000,E,AAN,08,0.9,32.4,7.5,,,V'),
    ).toMatchObject({
      type: 'GNS',
      posMode: 'AAN',
      numSv: 8,
      navStatus: 'V',
    });
    expect(decode('GNZDA,113902.00,18,10,2026,00,00')).toMatchObject({
      date: { year: 2026, month: 10, day: 18 },
    });
    expect(decode('GNZDA,113902.00,,,,,')).toMatchObject({ date: undefined });
    expect(decode('GNTXT,01,01,02,u-blox AG - www.u-blox.com')).toMatchObject({
      textId: 2,
      text: 'u-blox AG - www.u-blox.com',
    });
    expect(decode('GPXYZ,1,2')).toBeUndefined();
  });
});

describe('NmeaInterpreter (technical spec §6.2)', () => {
  it('turns a u-blox NMEA 4.11 epoch into fix, DOP, used set and satellites', () => {
    const events = feed(SAMPLE_EPOCH_NMEA);
    const fix = Object.assign({}, ...ofType(events, 'fix').map((e) => e.fix));
    expect(fix).toMatchObject({
      fixType: '3d',
      numSvUsed: 5,
      altMslM: 32.4,
      differential: false,
      carrierSolution: 'none',
    });
    expect(fix.lat).toBeCloseTo(1.3520833, 6);
    expect(fix.lon).toBeCloseTo(103.8198333, 6);
    expect(fix.altEllipsoidM).toBeCloseTo(39.9, 6);
    expect(fix.speedMps).toBeCloseTo(0.046 / 3.6, 6);
    expect(fix.utc).toEqual({
      epochMs: Date.UTC(2026, 9, 18, 11, 39, 2),
      dateValid: true,
      timeValid: true,
    });

    expect(ofType(events, 'dop')[0].dop).toEqual({ p: 1.42, h: 0.78, v: 1.18 });
    expect(ofType(events, 'used')[0]).toEqual({
      t: 'used',
      scope: 'all',
      keys: ['GPS:14', 'GPS:17', 'GPS:30', 'GALILEO:16'],
    });

    const sats = ofType(events, 'satellites').flatMap((e) => e.sats);
    expect(sats.map((s) => s.key)).toEqual([
      'GPS:14',
      'GPS:17',
      'GPS:30',
      'GALILEO:16',
      'BEIDOU:21',
    ]);
    expect(sats[0]).toMatchObject({
      elevation: 7,
      azimuth: 312,
      cn0: 25,
      signals: [{ code: 'L1CA', cn0: 25 }],
    });
    expect(sats[3].signals?.[0].code).toBe('E1BC');
    expect(sats[4].signals?.[0].code).toBe('B1I');

    const receiver = Object.assign({}, ...ofType(events, 'receiver').map((e) => e.patch));
    expect(receiver).toMatchObject({
      nmeaVersion: '4.10+',
      nmeaDetected: true,
      talkers: ['GA', 'GB', 'GN', 'GP'],
    });
  });

  it('assembles multi-part GSV groups and drops out-of-sequence parts', () => {
    const events = feed([
      'GPGSV,2,1,05,01,10,010,30,02,20,020,31,03,30,030,32,04,40,040,33',
      'GPGSV,2,2,05,05,50,050,34',
      'GPGSV,2,2,05,06,60,060,35', // stray part without a first part
      'GLGSV,2,1,05,65,10,010,30',
      'GLGSV,2,1,05,66,10,010,30', // restarts the group
      'GLGSV,2,2,05,67,10,010,30',
    ]);
    const sets = ofType(events, 'satellites');
    expect(sets.map((s) => s.sats.map((x) => x.key))).toEqual([
      ['GPS:1', 'GPS:2', 'GPS:3', 'GPS:4', 'GPS:5'],
      ['GLONASS:2', 'GLONASS:3'],
    ]);
    expect(sets[0].sats[0]).toMatchObject({ cn0: 30, signals: undefined });
  });

  it('treats an empty C/N0 as not tracked and an empty elevation as unknown position', () => {
    const sats = ofType(feed(['GPGSV,1,1,02,14,,,,17,34,257,']), 'satellites')[0].sats;
    expect(sats[0]).toMatchObject({ cn0: 0, elevation: undefined, azimuth: undefined });
    expect(sats[1]).toMatchObject({ cn0: 0, elevation: 34, azimuth: 257 });
  });

  it('derives fix type from GGA quality and GSA mode', () => {
    const last = (lines: string[]) => {
      const fixes = ofType(feed(lines), 'fix');
      return Object.assign({}, ...fixes.map((e) => e.fix)).fixType;
    };
    expect(last(['GPGGA,120000.00,,,,,0,00,99.9,,,,,,'])).toBe('none');
    expect(
      last([
        'GPGSA,A,2,05,06,07,,,,,,,,,,2.0,1.0,1.7',
        'GPGGA,120000.00,0121.1,N,10349.1,E,1,03,1.0,10,M,0,M,,',
      ]),
    ).toBe('2d');
    expect(last(['GPGGA,120000.00,0121.1,N,10349.1,E,6,03,1.0,10,M,0,M,,'])).toBe('dead-reckoning');
    expect(last(['GPRMC,120000.00,V,,,,,,,181026,,,N'])).toBe('none');
    expect(last(['GPRMC,120000.00,A,0121.1,N,10349.1,E,0.1,,181026,,,A'])).toBe('3d');
  });

  it('reports RTK carrier solutions and differential fixes from GGA', () => {
    const fix = (q: number) =>
      Object.assign(
        {},
        ...ofType(feed([`GNGGA,120000.00,0121.1,N,10349.1,E,${q},12,0.5,10,M,0,M,,`]), 'fix').map(
          (e) => e.fix,
        ),
      );
    expect(fix(4)).toMatchObject({ carrierSolution: 'fixed', differential: true });
    expect(fix(5)).toMatchObject({ carrierSolution: 'float', differential: true });
    expect(fix(2)).toMatchObject({ carrierSolution: 'none', differential: true });
  });

  it('uses the last known date for time-only sentences, or marks the date as a guess', () => {
    const withoutDate = ofType(
      feed(['GPGGA,120000.00,0121.1,N,10349.1,E,1,05,1.0,10,M,0,M,,']),
      'fix',
    )[0].fix.utc;
    expect(withoutDate?.dateValid).toBe(false);
    const withZda = ofType(
      feed([
        'GNZDA,120000.00,18,10,2026,00,00',
        'GPGGA,120001.00,0121.1,N,10349.1,E,1,05,1.0,10,M,0,M,,',
      ]),
      'fix',
    );
    expect(withZda[1].fix.utc).toEqual({
      epochMs: Date.UTC(2026, 9, 18, 12, 0, 1),
      dateValid: true,
      timeValid: true,
    });
  });

  it('resolves extended numbering in NMEA 4.0 GSA without system ID', () => {
    const used = ofType(
      feed(['GNGSA,A,3,14,70,46,,,,,,,,,,1.4,0.8,1.2', 'GNGGA,120000.00,,,,,1,03,1,,,,,,']),
      'used',
    )[0];
    expect(used.keys).toEqual(['GPS:14', 'GLONASS:6', 'SBAS:133']);
  });

  it('emits TXT messages as info at the right level', () => {
    const info = ofType(
      feed([
        'GPTXT,01,01,00,ANTSTATUS=OPEN',
        'GPTXT,01,01,01,warn',
        'GPTXT,01,01,02,note',
        'GPTXT,01,01,07,user',
      ]),
      'info',
    );
    expect(info.map((i) => i.level)).toEqual(['error', 'warning', 'notice', 'debug']);
    expect(info[0]).toMatchObject({ text: 'ANTSTATUS=OPEN', origin: 'NMEA GPTXT' });
  });

  it('detects NMEA versions from sentence features', () => {
    const version = (lines: string[]) =>
      ofType(feed(lines), 'receiver')
        .map((e) => e.patch.nmeaVersion)
        .filter(Boolean)
        .pop();
    expect(version(['GPRMC,120000.00,A,0121.1,N,10349.1,E,0.1,,181026,,'])).toBe('2.x');
    expect(version(['GPVTG,45.0,T,,M,1.0,N,1.852,K,A'])).toBe('2.3+');
    expect(version(['GNGNS,120000.00,0121.1,N,10349.1,E,AA,08,0.9,10,0,,,V'])).toBe('4.10+');
  });

  it('labels NMEA from the phone as android-nmea DOP', () => {
    const dop = ofType(
      feed(
        ['GPGSA,A,3,14,,,,,,,,,,,,1.4,0.8,1.2', 'GPGGA,1,,,,,1,,,,,,,,'],
        new NmeaInterpreter('android'),
      ),
      'dop',
    );
    expect(dop[0].origin).toBe('android-nmea');
  });

  it('ignores malformed lines', () => {
    const interpreter = new NmeaInterpreter();
    expect(interpreter.pushLine('not nmea', 0)).toEqual([]);
    expect(interpreter.pushLine('$GPXYZ,1*00', 0)).toEqual([]);
    expect(interpreter.pushLine(withChecksum('GPXYZ,1'), 0)).toEqual([]);
    expect(interpreter.flush()).toEqual([]);
  });
});
