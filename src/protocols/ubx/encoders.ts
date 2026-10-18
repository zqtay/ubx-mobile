/**
 * Encoders for UBX messages, used by the built-in demo receiver (replay sample log) and by
 * unit-test fixtures. Field layouts follow technical spec §6.5.
 */
import { ascii } from '../bytes';
import { buildUbx, PayloadWriter } from './builder';
import { UBX } from './ids';

/** GPS time of week (ms) used when a test doesn't care about the epoch. */
export const DEFAULT_ITOW = 123456000;

export interface PvtOptions {
  iTOW?: number;
  speedMmps?: number;
  headingDeg?: number;
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
    .u4(0, o.iTOW ?? DEFAULT_ITOW)
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
    .i4(60, o.speedMmps ?? 30)
    .i4(64, Math.round((o.headingDeg ?? 214.5) * 1e5))
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

export function navSat(svs: SatOptions[], iTOW = DEFAULT_ITOW): Uint8Array {
  const w = new PayloadWriter(8 + 12 * svs.length).u4(0, iTOW).u1(4, 1).u1(5, svs.length);
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

export function navSig(sigs: SigOptions[], iTOW = DEFAULT_ITOW): Uint8Array {
  const w = new PayloadWriter(8 + 16 * sigs.length).u4(0, iTOW).u1(4, 0).u1(5, sigs.length);
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
  iTOW = DEFAULT_ITOW,
): Uint8Array {
  const w = new PayloadWriter(18).u4(0, iTOW);
  [d.g, d.p, d.t, d.v, d.h, d.n, d.e].forEach((v, i) => w.u2(4 + 2 * i, Math.round(v * 100)));
  return buildUbx(UBX.NAV_DOP[0], UBX.NAV_DOP[1], w.build());
}

export function navStatus(ttffMs: number, iTOW = DEFAULT_ITOW): Uint8Array {
  const w = new PayloadWriter(16).u4(0, iTOW).u1(4, 3).u1(5, 1).u4(8, ttffMs).u4(12, 60000);
  return buildUbx(UBX.NAV_STATUS[0], UBX.NAV_STATUS[1], w.build());
}

export function monVer(sw: string, hw: string, extensions: string[]): Uint8Array {
  const w = new PayloadWriter(40 + 30 * extensions.length).ascii(0, sw, 30).ascii(30, hw, 10);
  extensions.forEach((e, i) => w.ascii(40 + 30 * i, e, 30));
  return buildUbx(UBX.MON_VER[0], UBX.MON_VER[1], w.build());
}

/**
 * MON-VER exactly as the Beitian BE-122 (u-blox M10, SPG 5.10) reports it — no `MOD=` line.
 * Verified byte-for-byte against the module's dump in `test/fixtures/be122.ts`.
 */
export const M10_MON_VER = (): Uint8Array =>
  monVer('ROM SPG 5.10 (7b202e)', '000A0000', [
    'FWVER=SPG 5.10',
    'PROTVER=34.10',
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
  const w = new PayloadWriter(8 + 12 * svs.length).u4(0, DEFAULT_ITOW).u1(4, svs.length).u1(5, 4);
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
