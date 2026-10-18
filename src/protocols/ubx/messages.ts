/**
 * UBX message decoders (technical spec §6.5). Each returns undefined when the payload is too
 * short for its declared contents, so a malformed frame can never throw.
 */

class Reader {
  private readonly view: DataView;
  constructor(readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  get length(): number {
    return this.bytes.length;
  }
  u1(o: number): number {
    return this.view.getUint8(o);
  }
  i1(o: number): number {
    return this.view.getInt8(o);
  }
  u2(o: number): number {
    return this.view.getUint16(o, true);
  }
  i2(o: number): number {
    return this.view.getInt16(o, true);
  }
  u4(o: number): number {
    return this.view.getUint32(o, true);
  }
  i4(o: number): number {
    return this.view.getInt32(o, true);
  }
  /** Null-terminated ASCII string in a fixed-size field. */
  str(o: number, len: number): string {
    let s = '';
    for (let i = o; i < o + len && i < this.bytes.length; i++) {
      const c = this.bytes[i];
      if (c === 0) break;
      s += String.fromCharCode(c);
    }
    return s.trim();
  }
}

const bit = (value: number, n: number): boolean => ((value >>> n) & 1) === 1;
const bits = (value: number, from: number, count: number): number =>
  (value >>> from) & ((1 << count) - 1);

// ---------------------------------------------------------------- NAV-PVT

export interface NavPvt {
  iTOW: number;
  year: number;
  month: number;
  day: number;
  hour: number;
  min: number;
  sec: number;
  validDate: boolean;
  validTime: boolean;
  fullyResolved: boolean;
  tAccNs: number;
  nanoNs: number;
  /** 0 none, 1 DR, 2 2D, 3 3D, 4 GNSS+DR, 5 time only. */
  fixType: number;
  gnssFixOk: boolean;
  diffSoln: boolean;
  /** 0 none, 1 float, 2 fixed. */
  carrSoln: number;
  numSV: number;
  lonDeg: number;
  latDeg: number;
  heightM: number;
  hMslM: number;
  hAccM: number;
  vAccM: number;
  gSpeedMps: number;
  headMotDeg: number;
  sAccMps: number;
  headAccDeg: number;
  pDop: number;
}

export function decodeNavPvt(p: Uint8Array): NavPvt | undefined {
  if (p.length < 84) return undefined;
  const r = new Reader(p);
  const valid = r.u1(11);
  const flags = r.u1(21);
  return {
    iTOW: r.u4(0),
    year: r.u2(4),
    month: r.u1(6),
    day: r.u1(7),
    hour: r.u1(8),
    min: r.u1(9),
    sec: r.u1(10),
    validDate: bit(valid, 0),
    validTime: bit(valid, 1),
    fullyResolved: bit(valid, 2),
    tAccNs: r.u4(12),
    nanoNs: r.i4(16),
    fixType: r.u1(20),
    gnssFixOk: bit(flags, 0),
    diffSoln: bit(flags, 1),
    carrSoln: bits(flags, 6, 2),
    numSV: r.u1(23),
    lonDeg: r.i4(24) * 1e-7,
    latDeg: r.i4(28) * 1e-7,
    heightM: r.i4(32) / 1000,
    hMslM: r.i4(36) / 1000,
    hAccM: r.u4(40) / 1000,
    vAccM: r.u4(44) / 1000,
    gSpeedMps: r.i4(60) / 1000,
    headMotDeg: r.i4(64) * 1e-5,
    sAccMps: r.u4(68) / 1000,
    headAccDeg: r.u4(72) * 1e-5,
    pDop: r.u2(76) * 0.01,
  };
}

// ---------------------------------------------------------------- NAV-SAT

export interface NavSatSv {
  gnssId: number;
  svId: number;
  cno: number;
  elev: number;
  azim: number;
  prResM: number;
  qualityInd: number;
  svUsed: boolean;
  /** 0 unknown, 1 healthy, 2 unhealthy. */
  health: number;
  diffCorr: boolean;
  smoothed: boolean;
  /** 0 none, 1 ephemeris, 2 almanac, 3 AssistNow Offline, 4 AssistNow Autonomous, 5–7 other. */
  orbitSource: number;
  ephAvail: boolean;
  almAvail: boolean;
  anoAvail: boolean;
  aopAvail: boolean;
  sbasCorrUsed: boolean;
  rtcmCorrUsed: boolean;
  slasCorrUsed: boolean;
  spartnCorrUsed: boolean;
  prCorrUsed: boolean;
  crCorrUsed: boolean;
  doCorrUsed: boolean;
  clasCorrUsed: boolean;
}

export interface NavSat {
  iTOW: number;
  version: number;
  svs: NavSatSv[];
}

export function decodeNavSat(p: Uint8Array): NavSat | undefined {
  if (p.length < 8) return undefined;
  const r = new Reader(p);
  const numSvs = r.u1(5);
  if (p.length < 8 + 12 * numSvs) return undefined;
  const svs: NavSatSv[] = [];
  for (let i = 0; i < numSvs; i++) {
    const o = 8 + 12 * i;
    const flags = r.u4(o + 8);
    svs.push({
      gnssId: r.u1(o),
      svId: r.u1(o + 1),
      cno: r.u1(o + 2),
      elev: r.i1(o + 3),
      azim: r.i2(o + 4),
      prResM: r.i2(o + 6) * 0.1,
      qualityInd: bits(flags, 0, 3),
      svUsed: bit(flags, 3),
      health: bits(flags, 4, 2),
      diffCorr: bit(flags, 6),
      smoothed: bit(flags, 7),
      orbitSource: bits(flags, 8, 3),
      ephAvail: bit(flags, 11),
      almAvail: bit(flags, 12),
      anoAvail: bit(flags, 13),
      aopAvail: bit(flags, 14),
      sbasCorrUsed: bit(flags, 16),
      rtcmCorrUsed: bit(flags, 17),
      slasCorrUsed: bit(flags, 18),
      spartnCorrUsed: bit(flags, 19),
      prCorrUsed: bit(flags, 20),
      crCorrUsed: bit(flags, 21),
      doCorrUsed: bit(flags, 22),
      clasCorrUsed: bit(flags, 23),
    });
  }
  return { iTOW: r.u4(0), version: r.u1(4), svs };
}

// ---------------------------------------------------------------- NAV-SIG

export interface NavSigSignal {
  gnssId: number;
  svId: number;
  sigId: number;
  freqId: number;
  prResM: number;
  cno: number;
  qualityInd: number;
  corrSource: number;
  ionoModel: number;
  /** 0 unknown, 1 healthy, 2 unhealthy. */
  health: number;
  prSmoothed: boolean;
  prUsed: boolean;
  crUsed: boolean;
  doUsed: boolean;
  prCorrUsed: boolean;
  crCorrUsed: boolean;
  doCorrUsed: boolean;
}

export interface NavSig {
  iTOW: number;
  version: number;
  signals: NavSigSignal[];
}

export function decodeNavSig(p: Uint8Array): NavSig | undefined {
  if (p.length < 8) return undefined;
  const r = new Reader(p);
  const numSigs = r.u1(5);
  if (p.length < 8 + 16 * numSigs) return undefined;
  const signals: NavSigSignal[] = [];
  for (let i = 0; i < numSigs; i++) {
    const o = 8 + 16 * i;
    const sigFlags = r.u2(o + 10);
    signals.push({
      gnssId: r.u1(o),
      svId: r.u1(o + 1),
      sigId: r.u1(o + 2),
      freqId: r.u1(o + 3),
      prResM: r.i2(o + 4) * 0.1,
      cno: r.u1(o + 6),
      qualityInd: r.u1(o + 7),
      corrSource: r.u1(o + 8),
      ionoModel: r.u1(o + 9),
      health: bits(sigFlags, 0, 2),
      prSmoothed: bit(sigFlags, 2),
      prUsed: bit(sigFlags, 3),
      crUsed: bit(sigFlags, 4),
      doUsed: bit(sigFlags, 5),
      prCorrUsed: bit(sigFlags, 6),
      crCorrUsed: bit(sigFlags, 7),
      doCorrUsed: bit(sigFlags, 8),
    });
  }
  return { iTOW: r.u4(0), version: r.u1(4), signals };
}

export const CORR_SOURCES: Record<number, string> = {
  0: 'none',
  1: 'SBAS',
  2: 'BeiDou SBAS',
  3: 'RTCM2',
  4: 'RTCM3 OSR',
  5: 'RTCM3 SSR',
  6: 'QZSS SLAS',
  7: 'SPARTN',
  8: 'CLAS',
};

// ---------------------------------------------------------------- NAV-DOP / NAV-STATUS / NAV-TIMELS

export interface NavDop {
  iTOW: number;
  gDop: number;
  pDop: number;
  tDop: number;
  vDop: number;
  hDop: number;
  nDop: number;
  eDop: number;
}

export function decodeNavDop(p: Uint8Array): NavDop | undefined {
  if (p.length < 18) return undefined;
  const r = new Reader(p);
  return {
    iTOW: r.u4(0),
    gDop: r.u2(4) * 0.01,
    pDop: r.u2(6) * 0.01,
    tDop: r.u2(8) * 0.01,
    vDop: r.u2(10) * 0.01,
    hDop: r.u2(12) * 0.01,
    nDop: r.u2(14) * 0.01,
    eDop: r.u2(16) * 0.01,
  };
}

export interface NavStatus {
  iTOW: number;
  gpsFix: number;
  gpsFixOk: boolean;
  diffSoln: boolean;
  ttffMs: number;
  msssMs: number;
}

export function decodeNavStatus(p: Uint8Array): NavStatus | undefined {
  if (p.length < 16) return undefined;
  const r = new Reader(p);
  const flags = r.u1(5);
  return {
    iTOW: r.u4(0),
    gpsFix: r.u1(4),
    gpsFixOk: bit(flags, 0),
    diffSoln: bit(flags, 1),
    ttffMs: r.u4(8),
    msssMs: r.u4(12),
  };
}

export interface NavTimeLs {
  currLs: number;
  validCurrLs: boolean;
}

export function decodeNavTimeLs(p: Uint8Array): NavTimeLs | undefined {
  if (p.length < 24) return undefined;
  const r = new Reader(p);
  return { currLs: r.i1(9), validCurrLs: bit(r.u1(23), 0) };
}

// ---------------------------------------------------------------- NAV-SVINFO (legacy)

export interface NavSvInfoSv {
  chn: number;
  svid: number;
  svUsed: boolean;
  diffCorr: boolean;
  orbitAvail: boolean;
  orbitEph: boolean;
  unhealthy: boolean;
  orbitAlm: boolean;
  orbitAop: boolean;
  smoothed: boolean;
  quality: number;
  cno: number;
  elev: number;
  azim: number;
  prResM: number;
}

export function decodeNavSvInfo(p: Uint8Array): { iTOW: number; svs: NavSvInfoSv[] } | undefined {
  if (p.length < 8) return undefined;
  const r = new Reader(p);
  const numCh = r.u1(4);
  if (p.length < 8 + 12 * numCh) return undefined;
  const svs: NavSvInfoSv[] = [];
  for (let i = 0; i < numCh; i++) {
    const o = 8 + 12 * i;
    const flags = r.u1(o + 2);
    svs.push({
      chn: r.u1(o),
      svid: r.u1(o + 1),
      svUsed: bit(flags, 0),
      diffCorr: bit(flags, 1),
      orbitAvail: bit(flags, 2),
      orbitEph: bit(flags, 3),
      unhealthy: bit(flags, 4),
      orbitAlm: bit(flags, 5),
      orbitAop: bit(flags, 6),
      smoothed: bit(flags, 7),
      quality: bits(r.u1(o + 3), 0, 4),
      cno: r.u1(o + 4),
      elev: r.i1(o + 5),
      azim: r.i2(o + 6),
      prResM: r.i4(o + 8) / 100,
    });
  }
  return { iTOW: r.u4(0), svs };
}

// ---------------------------------------------------------------- MON-VER / MON-HW / MON-RF / MON-GNSS

export interface MonVer {
  swVersion: string;
  hwVersion: string;
  extensions: string[];
}

export function decodeMonVer(p: Uint8Array): MonVer | undefined {
  if (p.length < 40) return undefined;
  const r = new Reader(p);
  const extensions: string[] = [];
  for (let o = 40; o + 30 <= p.length; o += 30) {
    const ext = r.str(o, 30);
    if (ext) extensions.push(ext);
  }
  return { swVersion: r.str(0, 30), hwVersion: r.str(30, 10), extensions };
}

export interface RfBlock {
  blockId: number;
  /** 0 unknown, 1 OK, 2 warning, 3 critical. */
  jammingState: number;
  /** 0 INIT, 1 DONTKNOW, 2 OK, 3 SHORT, 4 OPEN. */
  antStatus: number;
  /** 0 OFF, 1 ON, 2 DONTKNOW. */
  antPower: number;
  noisePerMS: number;
  /** 0..8191 */
  agcCnt: number;
  jamInd: number;
}

export function decodeMonHw(p: Uint8Array): RfBlock | undefined {
  if (p.length < 60) return undefined;
  const r = new Reader(p);
  return {
    blockId: 0,
    noisePerMS: r.u2(16),
    agcCnt: r.u2(18),
    antStatus: r.u1(20),
    antPower: r.u1(21),
    jammingState: bits(r.u1(22), 2, 2),
    jamInd: r.u1(45),
  };
}

export function decodeMonRf(p: Uint8Array): RfBlock[] | undefined {
  if (p.length < 4) return undefined;
  const r = new Reader(p);
  const nBlocks = r.u1(1);
  if (p.length < 4 + 24 * nBlocks) return undefined;
  const blocks: RfBlock[] = [];
  for (let i = 0; i < nBlocks; i++) {
    const o = 4 + 24 * i;
    blocks.push({
      blockId: r.u1(o),
      jammingState: bits(r.u1(o + 1), 0, 2),
      antStatus: r.u1(o + 2),
      antPower: r.u1(o + 3),
      noisePerMS: r.u2(o + 12),
      agcCnt: r.u2(o + 14),
      jamInd: r.u1(o + 16),
    });
  }
  return blocks;
}

export interface MonGnss {
  /** Bitmask: bit0 GPS, bit1 GLONASS, bit2 BeiDou, bit3 Galileo. */
  supported: number;
  defaultGnss: number;
  enabled: number;
  simultaneous: number;
}

export function decodeMonGnss(p: Uint8Array): MonGnss | undefined {
  if (p.length < 8) return undefined;
  const r = new Reader(p);
  return { supported: r.u1(1), defaultGnss: r.u1(2), enabled: r.u1(3), simultaneous: r.u1(4) };
}

// ---------------------------------------------------------------- SEC-UNIQID / ACK / INF

export function decodeSecUniqId(p: Uint8Array): string | undefined {
  if (p.length < 9) return undefined;
  const version = p[0];
  const idLength = version >= 2 && p.length >= 10 ? 6 : 5;
  let hex = '';
  for (let i = 4; i < 4 + idLength; i++) hex += p[i].toString(16).toUpperCase().padStart(2, '0');
  return hex;
}

export function decodeAck(p: Uint8Array): { clsID: number; msgID: number } | undefined {
  if (p.length < 2) return undefined;
  return { clsID: p[0], msgID: p[1] };
}

export function decodeInf(p: Uint8Array): string {
  let s = '';
  for (let i = 0; i < p.length; i++) {
    if (p[i] === 0) break;
    s += String.fromCharCode(p[i]);
  }
  return s;
}
