import { GnssAccumulator } from '@/state/GnssAccumulator';

import {
  concat,
  M10_MON_VER,
  monRf,
  navDop,
  navPvt,
  navSat,
  navStatus,
  nmea,
  SAMPLE_EPOCH_NMEA,
  secUniqId,
} from '../../../test/helpers/fixtures';
import { ProtocolPipeline } from '../pipeline';

/**
 * End-to-end: raw bytes from a u-blox M10 that outputs both NMEA and UBX → pipeline →
 * accumulator snapshot, as the USB source will do in M4.
 */
describe('ProtocolPipeline + GnssAccumulator', () => {
  const stream = concat(
    M10_MON_VER(),
    secUniqId([0xde, 0xad, 0xbe, 0xef, 0x01]),
    monRf([{ antStatus: 2, antPower: 1 }]),
    ...SAMPLE_EPOCH_NMEA.map(nmea),
    navPvt({ numSV: 4 }),
    navDop(),
    navStatus(28_400),
    navSat([
      { gnssId: 0, svId: 14, cno: 41, elev: 47, azim: 312, used: true },
      { gnssId: 0, svId: 17, cno: 19, elev: 34, azim: 257, used: true },
      { gnssId: 2, svId: 16, cno: 26, elev: 12, azim: 304, used: true },
      { gnssId: 3, svId: 25, cno: 25, elev: 0, azim: 0, orbitSource: 0 },
    ]),
  );

  function runThrough(chunkSize: number) {
    let t = 0;
    const acc = new GnssAccumulator({ satelliteTimeoutMs: 5000, now: () => t });
    acc.start('usb');
    const pipeline = new ProtocolPipeline();
    for (let o = 0; o < stream.length; o += chunkSize) {
      t += 1;
      acc.applyAll(pipeline.push(stream.subarray(o, o + chunkSize), t).events);
    }
    acc.applyAll(pipeline.flush());
    return acc.snapshot();
  }

  it.each([1, 17, 4096])('produces the same state for chunk size %i', (chunkSize) => {
    const snap = runThrough(chunkSize);

    expect(snap.device.receiver).toMatchObject({
      vendor: 'u-blox',
      fwVersion: 'SPG 5.10',
      protocolVersion: '34.10',
      uniqueId: 'DEADBEEF01',
      ubxDetected: true,
      nmeaDetected: true,
      nmeaVersion: '4.10+',
      rf: [{ antennaStatus: 'ok' }],
    });
    expect(snap.fix).toMatchObject({ fixType: '3d', fixOk: true, numSvUsed: 4 });
    expect(snap.dop).toMatchObject({ g: 1.61, p: 1.42 });
    expect(snap.session).toMatchObject({ ttffMs: 28_400, ttffSource: 'receiver' });
    expect(snap.stats).toMatchObject({
      ubxFrames: 7,
      nmeaFrames: SAMPLE_EPOCH_NMEA.length,
      junkBytes: 0,
    });

    // NAV-SAT supersedes NMEA for the satellites it reports; BeiDou 21 is only in NMEA.
    const byKey = Object.fromEntries(snap.satellites.map((s) => [s.key, s]));
    expect(byKey['GPS:14']).toMatchObject({ origin: 'ubx-nav-sat', cn0: 41, used: true });
    expect(byKey['BEIDOU:25']).toMatchObject({ origin: 'ubx-nav-sat', elevation: undefined });
    expect(byKey['BEIDOU:21']).toMatchObject({ origin: 'nmea', cn0: 24, used: false });
    expect(byKey['GPS:30']).toMatchObject({ origin: 'nmea', used: true });
  });
});
