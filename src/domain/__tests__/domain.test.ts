import { constellationMeta, constellationOrder, svLabel } from '../constellations';
import {
  fromAndroid,
  fromNmea,
  fromUbx,
  fromUbxLegacy,
  keyOf,
  satKey,
  talkerToConstellation,
  ubxGnssToConstellation,
} from '../satKey';
import { bandFromCarrier, isSecondFrequency, nmeaSignal, ubxSignal } from '../signals';

describe('satKey normalisation (technical spec §6.3)', () => {
  it.each([
    [0, 14, 'GPS:14'],
    [1, 123, 'SBAS:123'],
    [2, 16, 'GALILEO:16'],
    [3, 21, 'BEIDOU:21'],
    [4, 3, 'IMES:3'],
    [5, 2, 'QZSS:194'],
    [5, 194, 'QZSS:194'],
    [6, 5, 'GLONASS:5'],
    [7, 3, 'NAVIC:3'],
    [9, 1, 'UNKNOWN:1'],
  ])('UBX gnssId %i svId %i → %s', (gnssId, svId, key) => {
    expect(keyOf(fromUbx(gnssId, svId))).toBe(key);
  });

  it('identifies GLONASS satellites with unknown slot by frequency channel', () => {
    expect(fromUbx(6, 255, 4)).toEqual({ constellation: 'GLONASS', svid: 0, glonassFcn: -3 });
    expect(keyOf(fromUbx(6, 255, 4))).toBe('GLONASS:fcn-3');
    expect(keyOf(fromUbx(6, 255))).toBe('GLONASS:unknown');
    expect(satKey('GLONASS', 0, 2)).toBe('GLONASS:fcn2');
  });

  it.each([
    [14, 'GPS:14'],
    [33, 'BEIDOU:6'],
    [64, 'BEIDOU:37'],
    [70, 'GLONASS:6'],
    [131, 'SBAS:131'],
    [159, 'BEIDOU:1'],
    [175, 'IMES:3'],
    [195, 'QZSS:195'],
    [212, 'GALILEO:2'],
    [255, 'GLONASS:unknown'],
    [250, 'UNKNOWN:250'],
  ])('legacy NAV-SVINFO svid %i → %s', (svid, key) => {
    expect(keyOf(fromUbxLegacy(svid))).toBe(key);
  });

  it.each([
    [1, 14, 'GPS:14'],
    [2, 131, 'SBAS:131'],
    [3, 5, 'GLONASS:5'],
    [3, 97, 'GLONASS:fcn-3'],
    [4, 194, 'QZSS:194'],
    [4, 2, 'QZSS:194'],
    [5, 21, 'BEIDOU:21'],
    [6, 16, 'GALILEO:16'],
    [7, 3, 'NAVIC:3'],
    [0, 3, 'UNKNOWN:3'],
  ])('Android constellation %i svid %i → %s', (type, svid, key) => {
    expect(keyOf(fromAndroid(type, svid))).toBe(key);
  });

  it.each([
    // [talker, number, systemId, key]
    ['GP', 14, undefined, 'GPS:14'],
    ['GP', 46, undefined, 'SBAS:133'],
    ['GP', 194, undefined, 'QZSS:194'],
    ['GL', 70, undefined, 'GLONASS:6'],
    ['GL', 6, undefined, 'GLONASS:6'],
    ['GA', 16, undefined, 'GALILEO:16'],
    ['GA', 316, undefined, 'GALILEO:16'],
    ['GB', 21, undefined, 'BEIDOU:21'],
    ['BD', 421, undefined, 'BEIDOU:21'],
    ['GB', 221, undefined, 'BEIDOU:21'],
    ['GQ', 2, undefined, 'QZSS:194'],
    ['GQ', 195, undefined, 'QZSS:195'],
    ['GI', 3, undefined, 'NAVIC:3'],
    // GN talker: system ID (4.10+) decides; otherwise extended numbering.
    ['GN', 16, 3, 'GALILEO:16'],
    ['GN', 70, 2, 'GLONASS:6'],
    ['GN', 2, 5, 'QZSS:194'],
    ['GN', 5, 4, 'BEIDOU:5'],
    ['GN', 3, 6, 'NAVIC:3'],
    ['GN', 14, undefined, 'GPS:14'],
    ['GN', 70, undefined, 'GLONASS:6'],
    ['GN', 125, undefined, 'SBAS:125'],
    ['GN', 175, undefined, 'IMES:3'],
    ['GN', 310, undefined, 'GALILEO:10'],
    ['GN', 405, undefined, 'BEIDOU:5'],
    ['GN', 210, undefined, 'BEIDOU:10'],
  ] as const)('NMEA %s %i (system %s) → %s', (talker, n, systemId, key) => {
    const id = fromNmea(talker, n, systemId);
    expect(id && keyOf(id)).toBe(key);
  });

  it('rejects numbers that cannot be mapped', () => {
    expect(fromNmea('GN', 0)).toBeUndefined();
    expect(fromNmea('GN', 999)).toBeUndefined();
    expect(fromNmea('GA', 99)).toBeUndefined();
    expect(fromNmea('GB', 99)).toBeUndefined();
    expect(fromNmea('GQ', 50)).toBeUndefined();
    expect(fromNmea('GI', 20)).toBeUndefined();
    expect(fromNmea('GL', 200)).toBeUndefined();
  });

  it('maps talkers and UBX gnssIds', () => {
    expect(talkerToConstellation('GB')).toBe('BEIDOU');
    expect(talkerToConstellation('GN')).toBeUndefined();
    expect(ubxGnssToConstellation(6)).toBe('GLONASS');
    expect(ubxGnssToConstellation(42)).toBe('UNKNOWN');
  });
});

describe('svLabel (REQ-SET-02)', () => {
  it.each([
    ['GPS', 14, 'G14', 'G14'],
    ['GLONASS', 5, 'R5', 'R05'],
    ['GALILEO', 16, 'E16', 'E16'],
    ['BEIDOU', 25, 'B25', 'C25'],
    ['QZSS', 194, 'Q2', 'J02'],
    ['SBAS', 123, 'S123', 'S23'],
    ['NAVIC', 3, 'N3', 'I03'],
  ] as const)('%s %i → %s (u-center) / %s (RINEX)', (c, svid, ucenter, rinex) => {
    expect(svLabel(c, svid, 'ucenter')).toBe(ucenter);
    expect(svLabel(c, svid, 'rinex')).toBe(rinex);
  });

  it('labels GLONASS satellites with unknown slot by channel', () => {
    expect(svLabel('GLONASS', 0, 'ucenter', -3)).toBe('R?-3');
    expect(svLabel('GLONASS', 0, 'ucenter', 2)).toBe('R?+2');
  });

  it('orders constellations GPS first and falls back for unknown ids', () => {
    expect(constellationOrder('GPS')).toBeLessThan(constellationOrder('GALILEO'));
    expect(constellationMeta('BEIDOU').shape).toBe('pentagon');
    expect(constellationMeta('NOPE' as never).id).toBe('UNKNOWN');
    expect(constellationOrder('NOPE' as never)).toBeGreaterThan(constellationOrder('UNKNOWN'));
  });
});

describe('signal identification (technical spec §6.4)', () => {
  it('maps UBX signal IDs', () => {
    expect(ubxSignal(0, 0)).toEqual({ code: 'L1CA', label: 'L1C/A' });
    expect(ubxSignal(2, 5).code).toBe('E5bI');
    expect(ubxSignal(3, 5).code).toBe('B1C');
    expect(ubxSignal(6, 2).code).toBe('G2');
    expect(ubxSignal(0, 99).code).toBe('ubx-0-99');
  });

  it('maps NMEA 4.11 signal IDs, including hex IDs', () => {
    expect(nmeaSignal('GALILEO', 7)?.code).toBe('E1BC');
    expect(nmeaSignal('BEIDOU', 0xb)?.code).toBe('B2I');
    expect(nmeaSignal('GPS', 0)).toBeUndefined();
    expect(nmeaSignal('IMES', 3)?.code).toBe('nmea-IMES-3');
  });

  it('maps Android carrier frequencies to bands', () => {
    expect(bandFromCarrier('GPS', 1575.42e6)?.code).toBe('L1');
    expect(bandFromCarrier('GALILEO', 1575.42e6)?.code).toBe('E1');
    expect(bandFromCarrier('GPS', 1176.45e6)?.code).toBe('L5');
    expect(bandFromCarrier('GALILEO', 1176.45e6)?.code).toBe('E5a');
    expect(bandFromCarrier('BEIDOU', 1561.098e6)?.code).toBe('B1I');
    expect(bandFromCarrier('GLONASS', 1602.5625e6)?.code).toBe('G1');
    expect(bandFromCarrier('GLONASS', 1246.4375e6)?.code).toBe('G2');
    expect(bandFromCarrier('GPS', 1600e6)).toBeUndefined();
    expect(bandFromCarrier('GLONASS', 1575.42e6)).toBeUndefined();
  });

  it('detects second-frequency signals', () => {
    expect(isSecondFrequency('L5')).toBe(true);
    expect(isSecondFrequency('E5a')).toBe(true);
    expect(isSecondFrequency('B2I')).toBe(true);
    expect(isSecondFrequency('L1CA')).toBe(false);
    expect(isSecondFrequency('E1BC')).toBe(false);
  });
});
