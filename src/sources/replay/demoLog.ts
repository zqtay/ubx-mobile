import { ascii, concat } from '@/protocols/bytes';
import { withChecksum } from '@/protocols/nmea/checksum';
import {
  M10_MON_VER,
  monRf,
  navDop,
  navPvt,
  navSat,
  navSig,
  navStatus,
  secUniqId,
  type SatOptions,
  type SigOptions,
} from '@/protocols/ubx/encoders';

/**
 * Generates a deterministic log as a u-blox M10 configured for NMEA 4.11 + UBX would output it
 * (requirements REQ-SRC-05). Used by the Replay source for demos, development without hardware
 * and end-to-end tests. Satellite motion and signal levels are plausible, not physically exact.
 */

interface DemoSat {
  /** UBX gnssId. */
  gnssId: number;
  /** UBX svId (QZSS 1–10, SBAS PRN). */
  svId: number;
  az: number;
  el: number;
  /** Azimuth drift, degrees per second. */
  azRate: number;
  /** Elevation drift, degrees per second. */
  elRate: number;
  /** UBX sigIds tracked (M10 is single-band; BeiDou may track B1I and B1C). */
  sigIds: number[];
  unhealthy?: boolean;
  /** No orbit data: reported with signal but without position (u-center "Orbit none"). */
  noOrbit?: boolean;
  /** Signal blocked, e.g. by a building. */
  blocked?: boolean;
}

const SATS: DemoSat[] = [
  { gnssId: 0, svId: 2, az: 40, el: 8, azRate: 0.01, elRate: -0.01, sigIds: [0], blocked: true },
  { gnssId: 0, svId: 5, az: 95, el: 55, azRate: 0.02, elRate: 0.02, sigIds: [0] },
  { gnssId: 0, svId: 12, az: 160, el: 30, azRate: -0.02, elRate: 0.03, sigIds: [0] },
  { gnssId: 0, svId: 14, az: 312, el: 7, azRate: 0.02, elRate: 0.04, sigIds: [0] },
  { gnssId: 0, svId: 17, az: 257, el: 34, azRate: -0.03, elRate: -0.02, sigIds: [0] },
  { gnssId: 0, svId: 20, az: 20, el: 72, azRate: 0.05, elRate: -0.01, sigIds: [0] },
  { gnssId: 0, svId: 30, az: 330, el: 17, azRate: 0.01, elRate: 0.02, sigIds: [0] },
  { gnssId: 6, svId: 3, az: 282, el: 11, azRate: 0.02, elRate: 0.03, sigIds: [0] },
  { gnssId: 6, svId: 7, az: 200, el: 48, azRate: -0.02, elRate: 0.01, sigIds: [0] },
  { gnssId: 6, svId: 18, az: 120, el: 22, azRate: 0.03, elRate: -0.02, sigIds: [0] },
  { gnssId: 2, svId: 4, az: 65, el: 40, azRate: 0.02, elRate: 0.02, sigIds: [0] },
  { gnssId: 2, svId: 9, az: 140, el: 63, azRate: -0.01, elRate: -0.02, sigIds: [0] },
  { gnssId: 2, svId: 16, az: 304, el: 12, azRate: 0.02, elRate: 0.03, sigIds: [0] },
  {
    gnssId: 2,
    svId: 27,
    az: 230,
    el: 25,
    azRate: 0.01,
    elRate: 0.02,
    sigIds: [0],
    unhealthy: true,
  },
  { gnssId: 3, svId: 6, az: 350, el: 45, azRate: 0, elRate: 0, sigIds: [0, 5] },
  { gnssId: 3, svId: 21, az: 277, el: 5, azRate: 0.01, elRate: 0.03, sigIds: [0] },
  { gnssId: 3, svId: 25, az: 0, el: 0, azRate: 0, elRate: 0, sigIds: [0], noOrbit: true },
  { gnssId: 3, svId: 30, az: 180, el: 60, azRate: 0.02, elRate: -0.02, sigIds: [0, 5] },
  { gnssId: 5, svId: 2, az: 10, el: 52, azRate: 0, elRate: 0.01, sigIds: [0] },
  { gnssId: 5, svId: 3, az: 160, el: 70, azRate: 0, elRate: -0.01, sigIds: [0] },
  { gnssId: 1, svId: 133, az: 255, el: 38, azRate: 0, elRate: 0, sigIds: [0] },
  { gnssId: 1, svId: 137, az: 95, el: 30, azRate: 0, elRate: 0, sigIds: [0] },
];

/** NMEA 4.11 talker and GSV signal ID per UBX gnssId / sigId. */
const TALKER: Record<number, string> = { 0: 'GP', 1: 'GP', 2: 'GA', 3: 'GB', 5: 'GQ', 6: 'GL' };
const SYSTEM_ID: Record<number, number> = { 0: 1, 1: 1, 2: 3, 3: 4, 5: 5, 6: 2 };
const NMEA_SIGNAL: Record<number, Record<number, number>> = {
  0: { 0: 1 },
  1: { 0: 1 },
  2: { 0: 7 },
  3: { 0: 1, 5: 3 },
  5: { 0: 1 },
  6: { 0: 1 },
};

const LEAP_SECONDS = 18;
const START_UTC = Date.UTC(2026, 9, 18, 11, 39, 0); // a Sunday, so GPS time of week = time of day + leap seconds
const BASE_LAT = 1.3520833;
const BASE_LON = 103.8198333;
const FIRST_FIX_EPOCH = 3;

/** Small deterministic PRNG (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface SatState {
  sat: DemoSat;
  az: number;
  el: number;
  cno: number;
  used: boolean;
}

function satState(sat: DemoSat, t: number, random: () => number, hasFix: boolean): SatState {
  const az = (((sat.az + sat.azRate * t) % 360) + 360) % 360;
  const el = Math.max(-5, Math.min(89, sat.el + sat.elRate * t));
  let cno = 0;
  if (!sat.blocked && el > 0) {
    cno = Math.round(Math.min(49, 18 + 0.42 * el + (random() - 0.5) * 4));
  }
  const used = hasFix && cno >= 24 && el >= 8 && !sat.unhealthy && !sat.noOrbit;
  return { sat, az: Math.round(az), el: Math.round(el), cno, used };
}

const pad = (n: number, width: number, decimals = 0) =>
  n.toFixed(decimals).padStart(width + (decimals ? decimals + 1 : 0), '0');

function nmeaTime(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getUTCHours(), 2)}${pad(d.getUTCMinutes(), 2)}${pad(d.getUTCSeconds(), 2)}.00`;
}

function nmeaDate(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getUTCDate(), 2)}${pad(d.getUTCMonth() + 1, 2)}${pad(d.getUTCFullYear() % 100, 2)}`;
}

function nmeaLat(lat: number): string {
  const a = Math.abs(lat);
  const deg = Math.floor(a);
  return `${pad(deg, 2)}${pad((a - deg) * 60, 2, 5)},${lat >= 0 ? 'N' : 'S'}`;
}

function nmeaLon(lon: number): string {
  const a = Math.abs(lon);
  const deg = Math.floor(a);
  return `${pad(deg, 3)}${pad((a - deg) * 60, 2, 5)},${lon >= 0 ? 'E' : 'W'}`;
}

/** NMEA satellite number for GSA/GSV under NMEA 4.11 (strict numbering per talker). */
function nmeaSvNumber(sat: DemoSat): number {
  if (sat.gnssId === 1) return sat.svId - 87; // SBAS PRN 120–158 → 33–71 (GP talker)
  if (sat.gnssId === 6) return sat.svId + 64; // GLONASS slot → 65–96
  return sat.svId;
}

const line = (body: string) => ascii(`${withChecksum(body)}\r\n`);

function gsvSentences(states: SatState[]): string[] {
  const out: string[] = [];
  const groups = new Map<string, { talker: string; signal: number; sats: SatState[] }>();
  for (const s of states) {
    for (const sigId of s.sat.sigIds) {
      const talker = TALKER[s.sat.gnssId];
      const signal = NMEA_SIGNAL[s.sat.gnssId][sigId];
      const key = `${talker}:${signal}`;
      const group = groups.get(key) ?? { talker, signal, sats: [] };
      group.sats.push(s);
      groups.set(key, group);
    }
  }
  for (const { talker, signal, sats } of groups.values()) {
    const numMsg = Math.ceil(sats.length / 4);
    for (let m = 0; m < numMsg; m++) {
      const blocks = sats
        .slice(m * 4, m * 4 + 4)
        .map((s) => {
          const hasPos = !s.sat.noOrbit;
          return [
            pad(nmeaSvNumber(s.sat), 2),
            hasPos ? pad(Math.max(0, s.el), 2) : '',
            hasPos ? pad(s.az, 3) : '',
            s.cno > 0 ? pad(s.cno, 2) : '',
          ].join(',');
        })
        .join(',');
      out.push(
        `${talker}GSV,${numMsg},${m + 1},${pad(sats.length, 2)},${blocks},${signal.toString(16).toUpperCase()}`,
      );
    }
  }
  return out;
}

export interface DemoLogOptions {
  /** Number of 1 Hz epochs (default 180 = 3 minutes). */
  epochs?: number;
  seed?: number;
}

/** Builds the demo log bytes. Deterministic for a given seed. */
export function buildDemoLog(options: DemoLogOptions = {}): Uint8Array {
  const epochs = options.epochs ?? 180;
  const random = rng(options.seed ?? 42);
  const parts: Uint8Array[] = [
    line('GNTXT,01,01,02,u-blox AG - www.u-blox.com'),
    line('GNTXT,01,01,02,HW UBX 10 000A0000'),
    line('GNTXT,01,01,02,ANTSTATUS=OK'),
    M10_MON_VER(),
    secUniqId([0x9a, 0x3c, 0x51, 0x07, 0xe2]),
    monRf([{ antStatus: 2, antPower: 1, jamming: 1, jamInd: 9, noise: 87, agc: 5200 }]),
  ];

  for (let i = 0; i < epochs; i++) {
    const utc = START_UTC + i * 1000;
    const iTOW = ((utc % 86_400_000) + LEAP_SECONDS * 1000) % 604_800_000;
    const hasFix = i >= FIRST_FIX_EPOCH;
    const states = SATS.map((s) => satState(s, i, random, hasFix));
    const used = states.filter((s) => s.used);
    const pdop = used.length >= 4 ? Math.round((0.9 + 9 / used.length) * 100) / 100 : 99.99;
    const hdop = Math.round(pdop * 0.6 * 100) / 100;
    const vdop = Math.round(pdop * 0.8 * 100) / 100;
    const lat = BASE_LAT + (random() - 0.5) * 4e-6;
    const lon = BASE_LON + (random() - 0.5) * 4e-6;
    const altMsl = 32.4 + (random() - 0.5) * 0.6;
    const geoidSep = 7.5;
    const speedKnots = random() * 0.05;
    const time = nmeaTime(utc);

    // NMEA 4.11
    const nmea: string[] = [];
    if (hasFix) {
      nmea.push(
        `GNRMC,${time},A,${nmeaLat(lat)},${nmeaLon(lon)},${speedKnots.toFixed(3)},,${nmeaDate(utc)},,,A,V`,
      );
      nmea.push(`GNVTG,,T,,M,${speedKnots.toFixed(3)},N,${(speedKnots * 1.852).toFixed(3)},K,A`);
      nmea.push(
        `GNGGA,${time},${nmeaLat(lat)},${nmeaLon(lon)},1,${pad(Math.min(12, used.length), 2)},${hdop.toFixed(2)},${altMsl.toFixed(1)},M,${geoidSep.toFixed(1)},M,,`,
      );
    } else {
      nmea.push(`GNRMC,${time},V,,,,,,,${nmeaDate(utc)},,,N,V`);
      nmea.push('GNVTG,,T,,M,,N,,K,N');
      nmea.push(`GNGGA,${time},,,,,0,00,99.99,,,,,,`);
    }
    for (const [gnssId, systemId] of [
      [0, 1],
      [6, 2],
      [2, 3],
      [3, 4],
      [5, 5],
    ] as const) {
      const svs = used
        .filter(
          (s) =>
            SYSTEM_ID[s.sat.gnssId] === systemId && (s.sat.gnssId === gnssId || s.sat.gnssId === 1),
        )
        .slice(0, 12)
        .map((s) => pad(nmeaSvNumber(s.sat), 2));
      const fields = [...svs, ...Array(12 - svs.length).fill('')].join(',');
      nmea.push(
        `GNGSA,A,${hasFix ? 3 : 1},${fields},${pdop.toFixed(2)},${hdop.toFixed(2)},${vdop.toFixed(2)},${systemId}`,
      );
    }
    nmea.push(...gsvSentences(states));
    nmea.push(
      hasFix ? `GNGLL,${nmeaLat(lat)},${nmeaLon(lon)},${time},A,A` : `GNGLL,,,,,${time},V,N`,
    );
    parts.push(...nmea.map(line));

    // UBX
    const d = new Date(utc);
    parts.push(
      navPvt({
        iTOW,
        fixType: hasFix ? 3 : 0,
        gnssFixOk: hasFix,
        latDeg: lat,
        lonDeg: lon,
        hMslMm: Math.round(altMsl * 1000),
        heightMm: Math.round((altMsl + geoidSep) * 1000),
        numSV: used.length,
        date: [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()],
        time: [d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()],
        pDop: pdop,
        speedMmps: Math.round(speedKnots * 514.444),
      }),
    );
    const satOptions: SatOptions[] = states.map((s) => ({
      gnssId: s.sat.gnssId,
      svId: s.sat.svId,
      cno: s.cno,
      elev: s.sat.noOrbit ? 0 : s.el,
      azim: s.sat.noOrbit ? 0 : s.az,
      prRes: s.used ? Math.round((random() - 0.5) * 30) / 10 : 0,
      quality: s.cno === 0 ? 1 : s.used ? 7 : 4,
      used: s.used,
      health: s.sat.unhealthy ? 2 : s.sat.noOrbit ? 0 : 1,
      orbitSource: s.sat.noOrbit ? 0 : 1,
      eph: !s.sat.noOrbit && s.cno > 0,
      alm: !s.sat.noOrbit,
      sbasCorr: s.used && s.sat.gnssId === 0 && hasFix,
    }));
    parts.push(navSat(satOptions, iTOW));
    const sigOptions: SigOptions[] = states.flatMap((s) =>
      s.sat.sigIds.map((sigId, k) => ({
        gnssId: s.sat.gnssId,
        svId: s.sat.svId,
        sigId,
        freqId: s.sat.gnssId === 6 ? 7 : 0,
        cno: Math.max(0, s.cno - k * 3),
        quality: s.cno === 0 ? 1 : s.used ? 7 : 4,
        prUsed: s.used && k === 0,
        health: s.sat.unhealthy ? 2 : 1,
        corrSource: s.used && s.sat.gnssId === 0 ? 1 : 0,
      })),
    );
    parts.push(navSig(sigOptions, iTOW));
    parts.push(
      navDop(
        { g: pdop * 1.15, p: pdop, t: pdop * 0.55, v: vdop, h: hdop, n: hdop * 0.7, e: hdop * 0.7 },
        iTOW,
      ),
    );
    parts.push(navStatus(hasFix ? FIRST_FIX_EPOCH * 1000 + 240 : 0, iTOW));
    if (i % 10 === 9) {
      parts.push(
        monRf([
          { antStatus: 2, antPower: 1, jamming: 1, jamInd: 8 + (i % 3), noise: 87, agc: 5200 },
        ]),
      );
    }
  }
  return concat(...parts);
}
