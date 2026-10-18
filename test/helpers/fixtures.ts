/**
 * Synthetic protocol fixtures for unit tests. Frames are built with the production builder so
 * checksums are always valid; tests corrupt them explicitly where needed.
 */
import { withChecksum } from '@/protocols/nmea/checksum';
import { crc24q } from '@/protocols/rtcm/crc24q';
import { buildUbx, PayloadWriter } from '@/protocols/ubx/builder';
import { UBX } from '@/protocols/ubx/ids';

export const ascii = (s: string): Uint8Array => Uint8Array.from(s, (c) => c.charCodeAt(0));

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** NMEA sentence (body without `$` and checksum) → bytes with checksum and CRLF. */
export const nmea = (body: string): Uint8Array => ascii(`${withChecksum(body)}\r\n`);

/** One epoch of u-blox M10-style NMEA 4.11 output: GPS + Galileo + BeiDou, 5 satellites. */
export const SAMPLE_EPOCH_NMEA = [
  'GNRMC,113902.00,A,0121.12500,N,10349.19000,E,0.025,,181026,,,A,V',
  'GNVTG,,T,,M,0.025,N,0.046,K,A',
  'GNGGA,113902.00,0121.12500,N,10349.19000,E,1,05,0.78,32.4,M,7.5,M,,',
  'GNGSA,A,3,14,17,30,,,,,,,,,,1.42,0.78,1.18,1',
  'GNGSA,A,3,16,,,,,,,,,,,,1.42,0.78,1.18,3',
  'GNGSA,A,3,,,,,,,,,,,,,1.42,0.78,1.18,4',
  'GPGSV,1,1,03,14,07,312,25,17,34,257,19,30,17,330,21,1',
  'GAGSV,1,1,01,16,12,304,26,7',
  'GBGSV,1,1,01,21,05,277,24,1',
  'GNGLL,0121.12500,N,10349.19000,E,113902.00,A,A',
];

export interface PvtOptions {
  fixType?: number;
  gnssFixOk?: boolean;
  carrSoln?: number;
  latDeg?: number;
  lonDeg?: number;
  heightMm?: number;
  hMslMm?: number;
  numSV?: number;
  date?: [number, number, number];
  time?: [number, number, number];
  validDate?: boolean;
  validTime?: boolean;
  pDop?: number;
}

export function navPvt(o: PvtOptions = {}): Uint8Array {
  const [year, month, day] = o.date ?? [2026, 10, 18];
  const [hour, min, sec] = o.time ?? [11, 39, 2];
  const valid = ((o.validDate ?? true) ? 1 : 0) | ((o.validTime ?? true) ? 2 : 0) | 4;
  const flags = ((o.gnssFixOk ?? true) ? 1 : 0) | ((o.carrSoln ?? 0) << 6);
  const w = new PayloadWriter(92)
    .u4(0, 123456000)
    .u2(4, year)
    .u1(6, month)
    .u1(7, day)
    .u1(8, hour)
    .u1(9, min)
    .u1(10, sec)
    .u1(11, valid)
    .u4(12, 25)
    .i4(16, 0)
    .u1(20, o.fixType ?? 3)
    .u1(21, flags)
    .u1(23, o.numSV ?? 12)
    .i4(24, Math.round((o.lonDeg ?? 103.8198333) * 1e7))
    .i4(28, Math.round((o.latDeg ?? 1.3520833) * 1e7))
    .i4(32, o.heightMm ?? 39900)
    .i4(36, o.hMslMm ?? 32400)
    .u4(40, 1800)
    .u4(44, 2900)
    .i4(60, 30)
    .i4(64, 21450000)
    .u4(68, 100)
    .u4(72, 500000)
    .u2(76, Math.round((o.pDop ?? 1.42) * 100));
  return buildUbx(UBX.NAV_PVT[0], UBX.NAV_PVT[1], w.build());
}

export interface SatOptions {
  gnssId: number;
  svId: number;
  cno: number;
  elev: number;
  azim: number;
  prRes?: number;
  quality?: number;
  used?: boolean;
  health?: number;
  orbitSource?: number;
  eph?: boolean;
  alm?: boolean;
  sbasCorr?: boolean;
}

export function navSat(svs: SatOptions[]): Uint8Array {
  const w = new PayloadWriter(8 + 12 * svs.length).u4(0, 123456000).u1(4, 1).u1(5, svs.length);
  svs.forEach((s, i) => {
    const o = 8 + 12 * i;
    const flags =
      (s.quality ?? 7) |
      ((s.used ? 1 : 0) << 3) |
      ((s.health ?? 1) << 4) |
      ((s.orbitSource ?? 1) << 8) |
      (((s.eph ?? true) ? 1 : 0) << 11) |
      (((s.alm ?? true) ? 1 : 0) << 12) |
      ((s.sbasCorr ? 1 : 0) << 16);
    w.u1(o, s.gnssId)
      .u1(o + 1, s.svId)
      .u1(o + 2, s.cno)
      .i1(o + 3, s.elev)
      .i2(o + 4, s.azim)
      .i2(o + 6, Math.round((s.prRes ?? 0) * 10))
      .u4(o + 8, flags);
  });
  return buildUbx(UBX.NAV_SAT[0], UBX.NAV_SAT[1], w.build());
}

export interface SigOptions {
  gnssId: number;
  svId: number;
  sigId: number;
  freqId?: number;
  cno: number;
  quality?: number;
  prUsed?: boolean;
  health?: number;
  corrSource?: number;
}

export function navSig(sigs: SigOptions[]): Uint8Array {
  const w = new PayloadWriter(8 + 16 * sigs.length).u4(0, 123456000).u1(4, 0).u1(5, sigs.length);
  sigs.forEach((s, i) => {
    const o = 8 + 16 * i;
    w.u1(o, s.gnssId)
      .u1(o + 1, s.svId)
      .u1(o + 2, s.sigId)
      .u1(o + 3, s.freqId ?? 0)
      .i2(o + 4, -4)
      .u1(o + 6, s.cno)
      .u1(o + 7, s.quality ?? 7)
      .u1(o + 8, s.corrSource ?? 0)
      .u2(o + 10, (s.health ?? 1) | ((s.prUsed ? 1 : 0) << 3));
  });
  return buildUbx(UBX.NAV_SIG[0], UBX.NAV_SIG[1], w.build());
}

export function navDop(
  d = { g: 1.61, p: 1.42, t: 0.77, v: 1.18, h: 0.78, n: 0.55, e: 0.56 },
): Uint8Array {
  const w = new PayloadWriter(18).u4(0, 123456000);
  [d.g, d.p, d.t, d.v, d.h, d.n, d.e].forEach((v, i) => w.u2(4 + 2 * i, Math.round(v * 100)));
  return buildUbx(UBX.NAV_DOP[0], UBX.NAV_DOP[1], w.build());
}

export function navStatus(ttffMs: number): Uint8Array {
  const w = new PayloadWriter(16).u4(0, 123456000).u1(4, 3).u1(5, 1).u4(8, ttffMs).u4(12, 60000);
  return buildUbx(UBX.NAV_STATUS[0], UBX.NAV_STATUS[1], w.build());
}

export function monVer(sw: string, hw: string, extensions: string[]): Uint8Array {
  const w = new PayloadWriter(40 + 30 * extensions.length).ascii(0, sw, 30).ascii(30, hw, 10);
  extensions.forEach((e, i) => w.ascii(40 + 30 * i, e, 30));
  return buildUbx(UBX.MON_VER[0], UBX.MON_VER[1], w.build());
}

/** MON-VER as reported by a u-blox M10 (values representative of SPG 5.10 firmware). */
export const M10_MON_VER = (): Uint8Array =>
  monVer('ROM SPG 5.10 (7b202e)', '000A0000', [
    'FWVER=SPG 5.10',
    'PROTVER=34.10',
    'MOD=MIA-M10Q',
    'GPS;GLO;GAL;BDS',
    'SBAS;QZSS',
  ]);

export interface RfOptions {
  antStatus: number;
  antPower: number;
  jamming?: number;
  jamInd?: number;
  noise?: number;
  agc?: number;
}

export function monRf(blocks: RfOptions[]): Uint8Array {
  const w = new PayloadWriter(4 + 24 * blocks.length).u1(0, 0).u1(1, blocks.length);
  blocks.forEach((b, i) => {
    const o = 4 + 24 * i;
    w.u1(o, i)
      .u1(o + 1, b.jamming ?? 1)
      .u1(o + 2, b.antStatus)
      .u1(o + 3, b.antPower)
      .u2(o + 12, b.noise ?? 90)
      .u2(o + 14, b.agc ?? 4095)
      .u1(o + 16, b.jamInd ?? 12);
  });
  return buildUbx(UBX.MON_RF[0], UBX.MON_RF[1], w.build());
}

export function monHw(b: RfOptions): Uint8Array {
  const w = new PayloadWriter(60)
    .u2(16, b.noise ?? 90)
    .u2(18, b.agc ?? 8191)
    .u1(20, b.antStatus)
    .u1(21, b.antPower)
    .u1(22, (b.jamming ?? 1) << 2)
    .u1(45, b.jamInd ?? 12);
  return buildUbx(UBX.MON_HW[0], UBX.MON_HW[1], w.build());
}

export function monGnss(
  supported: number,
  defaultGnss: number,
  enabled: number,
  simultaneous: number,
): Uint8Array {
  const w = new PayloadWriter(8)
    .u1(0, 0)
    .u1(1, supported)
    .u1(2, defaultGnss)
    .u1(3, enabled)
    .u1(4, simultaneous);
  return buildUbx(UBX.MON_GNSS[0], UBX.MON_GNSS[1], w.build());
}

export function secUniqId(id: number[], version = 1): Uint8Array {
  const w = new PayloadWriter(4 + id.length).u1(0, version).bytesAt(4, id);
  return buildUbx(UBX.SEC_UNIQID[0], UBX.SEC_UNIQID[1], w.build());
}

export interface SvInfoOptions {
  svid: number;
  cno: number;
  elev: number;
  azim: number;
  used?: boolean;
  orbitAvail?: boolean;
  eph?: boolean;
  unhealthy?: boolean;
  quality?: number;
}

export function navSvInfo(svs: SvInfoOptions[]): Uint8Array {
  const w = new PayloadWriter(8 + 12 * svs.length).u4(0, 123456000).u1(4, svs.length).u1(5, 4);
  svs.forEach((s, i) => {
    const o = 8 + 12 * i;
    const flags =
      (s.used ? 1 : 0) |
      (((s.orbitAvail ?? true) ? 1 : 0) << 2) |
      (((s.eph ?? true) ? 1 : 0) << 3) |
      ((s.unhealthy ? 1 : 0) << 4);
    w.u1(o, i)
      .u1(o + 1, s.svid)
      .u1(o + 2, flags)
      .u1(o + 3, s.quality ?? 7)
      .u1(o + 4, s.cno)
      .i1(o + 5, s.elev)
      .i2(o + 6, s.azim)
      .i4(o + 8, -35);
  });
  return buildUbx(UBX.NAV_SVINFO[0], UBX.NAV_SVINFO[1], w.build());
}

export const infNotice = (text: string): Uint8Array =>
  buildUbx(UBX.INF_NOTICE[0], UBX.INF_NOTICE[1], ascii(text));

/** A valid RTCM 3 frame (message type 1005, zero payload body) for decoder tests. */
export function rtcm1005(): Uint8Array {
  // Preamble, 10-bit length, payload (message type in the first 12 bits), CRC-24Q.
  const payload = new Uint8Array(19);
  payload[0] = 1005 >> 4;
  payload[1] = (1005 & 0x0f) << 4;
  const frame = new Uint8Array(3 + payload.length + 3);
  frame[0] = 0xd3;
  frame[1] = 0;
  frame[2] = payload.length;
  frame.set(payload, 3);
  const crc = crc24q(frame, 0, 3 + payload.length);
  frame[3 + payload.length] = (crc >> 16) & 0xff;
  frame[4 + payload.length] = (crc >> 8) & 0xff;
  frame[5 + payload.length] = crc & 0xff;
  return frame;
}
