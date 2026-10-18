import type { GnssEvent } from '@/domain/events';

import {
  ascii,
  infNotice,
  M10_MON_VER,
  monGnss,
  monHw,
  monRf,
  monVer,
  navDop,
  navPvt,
  navSat,
  navSig,
  navStatus,
  navSvInfo,
  secUniqId,
} from '../../../test/helpers/fixtures';
import { buildPoll, buildUbx } from '../ubx/builder';
import { ubxChecksum } from '../ubx/checksum';
import { isMessage, UBX, ubxMessageName } from '../ubx/ids';
import { interpretUbx } from '../ubx/interpreter';
import * as msg from '../ubx/messages';

/** Splits a built frame back into class, id and payload. */
const parts = (frame: Uint8Array) => ({
  cls: frame[2],
  id: frame[3],
  payload: frame.subarray(6, frame.length - 2),
});
const run = (frame: Uint8Array): GnssEvent[] => {
  const { cls, id, payload } = parts(frame);
  return interpretUbx(cls, id, payload, 1000);
};
const ofType = <T extends GnssEvent['t']>(events: GnssEvent[], t: T) =>
  events.filter((e): e is Extract<GnssEvent, { t: T }> => e.t === t);

describe('UBX framing', () => {
  it('builds polls with a valid Fletcher checksum', () => {
    const poll = buildPoll(UBX.MON_VER);
    expect([...poll]).toEqual([0xb5, 0x62, 0x0a, 0x04, 0x00, 0x00, 0x0e, 0x34]);
    const frame = buildUbx(0x06, 0x8b, Uint8Array.of(0, 0, 0, 0));
    const ck = ubxChecksum(frame, 2, frame.length - 2);
    expect([frame[frame.length - 2], frame[frame.length - 1]]).toEqual([ck & 0xff, ck >> 8]);
  });

  it('names known and unknown messages', () => {
    expect(ubxMessageName(0x01, 0x07)).toBe('UBX-NAV-PVT');
    expect(ubxMessageName(0x27, 0x03)).toBe('UBX-SEC-UNIQID');
    expect(ubxMessageName(0x01, 0x99)).toBe('UBX-NAV-0x99');
    expect(ubxMessageName(0x77, 0x01)).toBe('UBX-0x77-0x01');
    expect(isMessage(0x01, 0x35, UBX.NAV_SAT)).toBe(true);
  });
});

describe('UBX decoders', () => {
  it('rejects payloads that are too short', () => {
    const short = new Uint8Array(3);
    expect(msg.decodeNavPvt(short)).toBeUndefined();
    expect(msg.decodeNavSat(short)).toBeUndefined();
    expect(msg.decodeNavSig(short)).toBeUndefined();
    expect(msg.decodeNavDop(short)).toBeUndefined();
    expect(msg.decodeNavStatus(short)).toBeUndefined();
    expect(msg.decodeNavTimeLs(short)).toBeUndefined();
    expect(msg.decodeNavSvInfo(short)).toBeUndefined();
    expect(msg.decodeMonVer(short)).toBeUndefined();
    expect(msg.decodeMonHw(short)).toBeUndefined();
    expect(msg.decodeMonRf(Uint8Array.of(0))).toBeUndefined();
    expect(msg.decodeMonGnss(short)).toBeUndefined();
    expect(msg.decodeSecUniqId(short)).toBeUndefined();
    expect(msg.decodeAck(Uint8Array.of(1))).toBeUndefined();
    // Declared counts larger than the payload.
    expect(msg.decodeNavSat(Uint8Array.of(0, 0, 0, 0, 1, 5, 0, 0))).toBeUndefined();
    expect(msg.decodeNavSig(Uint8Array.of(0, 0, 0, 0, 0, 5, 0, 0))).toBeUndefined();
    expect(msg.decodeNavSvInfo(Uint8Array.of(0, 0, 0, 0, 5, 0, 0, 0))).toBeUndefined();
    expect(msg.decodeMonRf(Uint8Array.of(0, 3, 0, 0))).toBeUndefined();
  });

  it('decodes NAV-PVT', () => {
    const m = msg.decodeNavPvt(parts(navPvt({ fixType: 3, carrSoln: 2, numSV: 14 })).payload)!;
    expect(m).toMatchObject({
      year: 2026,
      month: 10,
      day: 18,
      hour: 11,
      fixType: 3,
      gnssFixOk: true,
      carrSoln: 2,
      numSV: 14,
    });
    expect(m.latDeg).toBeCloseTo(1.3520833, 6);
    expect(m.hMslM).toBeCloseTo(32.4, 6);
    expect(m.headMotDeg).toBeCloseTo(214.5, 6);
    expect(m.pDop).toBeCloseTo(1.42, 6);
  });

  it('decodes NAV-SAT flag bits', () => {
    const m = msg.decodeNavSat(
      parts(
        navSat([
          {
            gnssId: 0,
            svId: 14,
            cno: 41,
            elev: 47,
            azim: 312,
            prRes: -0.4,
            quality: 7,
            used: true,
            health: 2,
            sbasCorr: true,
          },
        ]),
      ).payload,
    )!;
    expect(m.svs[0]).toMatchObject({
      gnssId: 0,
      svId: 14,
      cno: 41,
      elev: 47,
      azim: 312,
      qualityInd: 7,
      svUsed: true,
      health: 2,
      orbitSource: 1,
      ephAvail: true,
      almAvail: true,
      sbasCorrUsed: true,
      rtcmCorrUsed: false,
    });
    expect(m.svs[0].prResM).toBeCloseTo(-0.4, 6);
  });

  it('decodes NAV-TIMELS, ACK and INF', () => {
    const timels = new Uint8Array(24);
    timels[9] = 18;
    timels[23] = 1;
    expect(msg.decodeNavTimeLs(timels)).toEqual({ currLs: 18, validCurrLs: true });
    expect(msg.decodeAck(Uint8Array.of(0x06, 0x8a))).toEqual({ clsID: 0x06, msgID: 0x8a });
    expect(msg.decodeInf(Uint8Array.of(0x68, 0x69, 0, 0x7a))).toBe('hi');
  });

  it('decodes SEC-UNIQID versions 1 and 2', () => {
    expect(msg.decodeSecUniqId(parts(secUniqId([0xde, 0xad, 0xbe, 0xef, 0x01])).payload)).toBe(
      'DEADBEEF01',
    );
    expect(msg.decodeSecUniqId(parts(secUniqId([1, 2, 3, 4, 5, 6], 2)).payload)).toBe(
      '010203040506',
    );
  });
});

describe('interpretUbx (technical spec §6.5)', () => {
  it('maps NAV-PVT to a fix and PDOP', () => {
    const events = run(navPvt({ carrSoln: 1 }));
    const fix = ofType(events, 'fix')[0];
    expect(fix.origin).toBe('ubx');
    expect(fix.fix).toMatchObject({
      fixType: '3d',
      fixOk: true,
      carrierSolution: 'float',
      numSvUsed: 12,
    });
    expect(fix.fix.utc).toEqual({
      epochMs: Date.UTC(2026, 9, 18, 11, 39, 2),
      dateValid: true,
      timeValid: true,
      fullyResolved: true,
    });
    expect(ofType(events, 'dop')[0].dop.p).toBeCloseTo(1.42, 6);
  });

  it('omits position for no-fix and time-only solutions and missing time when invalid', () => {
    const fix = ofType(
      run(navPvt({ fixType: 0, validDate: false, validTime: false, pDop: 0 })),
      'fix',
    )[0].fix;
    expect(fix.fixType).toBe('none');
    expect(fix.lat).toBeUndefined();
    expect(fix.utc).toBeUndefined();
    expect(ofType(run(navPvt({ fixType: 5 })), 'fix')[0].fix.lat).toBeUndefined();
    expect(ofType(run(navPvt({ pDop: 0 })), 'dop')).toHaveLength(0);
  });

  it('maps NAV-SAT to satellite observations with unknown positions handled', () => {
    const sats = ofType(
      run(
        navSat([
          { gnssId: 0, svId: 14, cno: 41, elev: 47, azim: 312, used: true },
          {
            gnssId: 3,
            svId: 25,
            cno: 25,
            elev: 0,
            azim: 0,
            orbitSource: 0,
            eph: false,
            alm: false,
          },
          { gnssId: 5, svId: 2, cno: 0, elev: -91, azim: 0 },
        ]),
      ),
      'satellites',
    )[0];
    expect(sats.origin).toBe('ubx-nav-sat');
    expect(sats.sats[0]).toMatchObject({
      key: 'GPS:14',
      cn0: 41,
      elevation: 47,
      azimuth: 312,
      used: true,
      health: 'healthy',
      orbitSource: 'ephemeris',
      quality: 7,
      corrections: { sbas: false },
    });
    // u-center's "B25 … Orbit none" row: no orbit → position unknown.
    expect(sats.sats[1]).toMatchObject({
      key: 'BEIDOU:25',
      orbitSource: 'none',
      elevation: undefined,
      azimuth: undefined,
      hasEphemeris: false,
    });
    expect(sats.sats[2]).toMatchObject({ key: 'QZSS:194', elevation: undefined });
  });

  it('maps NAV-SIG to per-signal observations, including GLONASS unknown slots', () => {
    const signals = ofType(
      run(
        navSig([
          { gnssId: 0, svId: 14, sigId: 0, cno: 41, prUsed: true },
          { gnssId: 0, svId: 14, sigId: 3, cno: 35, corrSource: 1 },
          { gnssId: 6, svId: 255, sigId: 0, freqId: 4, cno: 30 },
        ]),
      ),
      'signals',
    )[0].signals;
    expect(signals[0]).toMatchObject({
      key: 'GPS:14',
      code: 'L1CA',
      cn0: 41,
      used: true,
      health: 'healthy',
      corrSource: 'none',
      lastSeenMs: 1000,
    });
    expect(signals[1]).toMatchObject({ code: 'L2CL', corrSource: 'SBAS', used: false });
    expect(signals[2]).toMatchObject({ key: 'GLONASS:fcn-3', code: 'G1', glonassFcn: -3 });
    expect(signals[0].prResidualM).toBeCloseTo(-0.4, 6);
  });

  it('maps NAV-DOP and NAV-STATUS', () => {
    expect(ofType(run(navDop()), 'dop')[0].dop).toEqual({
      g: 1.61,
      p: 1.42,
      t: 0.77,
      v: 1.18,
      h: 0.78,
      n: 0.55,
      e: 0.56,
    });
    expect(run(navStatus(28400))).toEqual([{ t: 'ttff', ms: 28400 }]);
    expect(run(navStatus(0))).toEqual([]);
  });

  it('maps legacy NAV-SVINFO', () => {
    const sats = ofType(
      run(
        navSvInfo([
          { svid: 14, cno: 40, elev: 45, azim: 90, used: true },
          { svid: 70, cno: 30, elev: 10, azim: 10, orbitAvail: false, unhealthy: true },
        ]),
      ),
      'satellites',
    )[0];
    expect(sats.origin).toBe('ubx-nav-svinfo');
    expect(sats.sats[0]).toMatchObject({
      key: 'GPS:14',
      used: true,
      elevation: 45,
      hasEphemeris: true,
      health: undefined,
    });
    expect(sats.sats[1]).toMatchObject({
      key: 'GLONASS:6',
      elevation: undefined,
      health: 'unhealthy',
    });
    expect(sats.sats[0].prResidualM).toBeCloseTo(-0.35, 6);
  });

  it('extracts receiver identity from MON-VER', () => {
    const patch = ofType(run(M10_MON_VER()), 'receiver')[0].patch;
    expect(patch).toMatchObject({
      vendor: 'u-blox',
      ubxDetected: true,
      swVersion: 'ROM SPG 5.10 (7b202e)',
      hwVersion: '000A0000',
      fwVersion: 'SPG 5.10',
      protocolVersion: '34.10',
      module: 'MIA-M10Q',
      gnssSupported: ['GPS', 'GLONASS', 'GALILEO', 'BEIDOU', 'SBAS', 'QZSS'],
    });
    const plain = ofType(
      run(monVer('1.00 (59842)', '00070000', ['PROTVER 14.00', 'GPS;SBAS;GLO;QZSS', 'odd;tokens'])),
      'receiver',
    )[0].patch;
    expect(plain.fwVersion).toBeUndefined();
    expect(plain.gnssSupported).toEqual(['GPS', 'SBAS', 'GLONASS', 'QZSS']);
  });

  it('maps MON-RF and MON-HW antenna and jamming status', () => {
    const rf = ofType(
      run(monRf([{ antStatus: 4, antPower: 1, jamming: 2, jamInd: 40, agc: 8191 }])),
      'receiver',
    )[0].patch.rf!;
    expect(rf[0]).toMatchObject({
      blockId: 0,
      antennaStatus: 'open',
      antennaPower: 'on',
      jammingState: 'warning',
      jamIndicator: 40,
      agcPercent: 100,
    });
    const hw = ofType(run(monHw({ antStatus: 2, antPower: 2 })), 'receiver')[0].patch.rf!;
    expect(hw[0]).toMatchObject({
      antennaStatus: 'ok',
      antennaPower: 'unknown',
      jammingState: 'ok',
    });
  });

  it('maps MON-GNSS bitmasks, SEC-UNIQID and INF messages', () => {
    expect(ofType(run(monGnss(0x0f, 0x0d, 0x09, 4)), 'receiver')[0].patch).toEqual({
      gnssSupported: ['GPS', 'GLONASS', 'BEIDOU', 'GALILEO'],
      gnssDefault: ['GPS', 'BEIDOU', 'GALILEO'],
      gnssEnabled: ['GPS', 'GALILEO'],
      maxConcurrentGnss: 4,
    });
    expect(ofType(run(secUniqId([1, 2, 3, 4, 5])), 'receiver')[0].patch).toEqual({
      uniqueId: '0102030405',
    });
    expect(run(infNotice('ANTSUPERV=AC SD PDoS SR'))).toEqual([
      { t: 'info', level: 'notice', text: 'ANTSUPERV=AC SD PDoS SR', origin: 'UBX-INF-NOTICE' },
    ]);
    expect(run(buildUbx(0x04, 0x00, new Uint8Array(0)))).toEqual([]);
  });

  it('ignores unknown, ACK and truncated messages', () => {
    expect(interpretUbx(0x05, 0x01, Uint8Array.of(6, 0x8a), 0)).toEqual([]);
    expect(interpretUbx(0x77, 0x01, ascii('x'), 0)).toEqual([]);
    const truncated = new Uint8Array(2);
    for (const [cls, id] of Object.values(UBX))
      expect(interpretUbx(cls, id, truncated, 0)).toEqual([]);
  });
});
