import type { Constellation } from './types';

/**
 * Signal / band identification (technical spec §6.4). Every source maps its signal identifier
 * to a normalised `code` (stable, used for merging) and a human `label`.
 */
export interface SignalId {
  code: string;
  label: string;
}

const sig = (code: string, label: string): SignalId => ({ code, label });

/** UBX NAV-SIG (gnssId, sigId) → signal. */
const UBX_SIGNALS: Record<number, Record<number, SignalId>> = {
  0: {
    0: sig('L1CA', 'L1C/A'),
    3: sig('L2CL', 'L2 CL'),
    4: sig('L2CM', 'L2 CM'),
    6: sig('L5I', 'L5 I'),
    7: sig('L5Q', 'L5 Q'),
  },
  1: { 0: sig('L1CA', 'L1C/A') },
  2: {
    0: sig('E1C', 'E1 C'),
    1: sig('E1B', 'E1 B'),
    3: sig('E5aI', 'E5a I'),
    4: sig('E5aQ', 'E5a Q'),
    5: sig('E5bI', 'E5b I'),
    6: sig('E5bQ', 'E5b Q'),
    8: sig('E6B', 'E6 B'),
    9: sig('E6C', 'E6 C'),
    10: sig('E6A', 'E6 A'),
  },
  3: {
    0: sig('B1I', 'B1I D1'),
    1: sig('B1I', 'B1I D2'),
    2: sig('B2I', 'B2I D1'),
    3: sig('B2I', 'B2I D2'),
    5: sig('B1C', 'B1C'),
    7: sig('B2a', 'B2a'),
  },
  5: {
    0: sig('L1CA', 'L1C/A'),
    1: sig('L1S', 'L1S'),
    4: sig('L2CM', 'L2 CM'),
    5: sig('L2CL', 'L2 CL'),
    8: sig('L5I', 'L5 I'),
    9: sig('L5Q', 'L5 Q'),
  },
  6: { 0: sig('G1', 'L1 OF'), 2: sig('G2', 'L2 OF') },
  7: { 0: sig('L5A', 'L5 A') },
};

export function ubxSignal(gnssId: number, sigId: number): SignalId {
  return UBX_SIGNALS[gnssId]?.[sigId] ?? sig(`ubx-${gnssId}-${sigId}`, `Signal ${sigId}`);
}

/** NMEA 0183 v4.11 GSV signal ID (hex digit) per constellation. */
const NMEA_SIGNALS: Partial<Record<Constellation, Record<number, SignalId>>> = {
  GPS: {
    1: sig('L1CA', 'L1 C/A'),
    2: sig('L1PY', 'L1 P(Y)'),
    3: sig('L1M', 'L1 M'),
    4: sig('L2PY', 'L2 P(Y)'),
    5: sig('L2CM', 'L2C-M'),
    6: sig('L2CL', 'L2C-L'),
    7: sig('L5I', 'L5-I'),
    8: sig('L5Q', 'L5-Q'),
  },
  GLONASS: {
    1: sig('G1', 'G1 C/A'),
    2: sig('G1P', 'G1 P'),
    3: sig('G2', 'G2 C/A'),
    4: sig('G2P', 'G2 P'),
  },
  GALILEO: {
    1: sig('E5a', 'E5a'),
    2: sig('E5b', 'E5b'),
    3: sig('E5ab', 'E5 a+b'),
    4: sig('E6A', 'E6-A'),
    5: sig('E6BC', 'E6-BC'),
    6: sig('E1A', 'E1-A'),
    7: sig('E1BC', 'E1-B/C'),
  },
  BEIDOU: {
    1: sig('B1I', 'B1I'),
    2: sig('B1Q', 'B1Q'),
    3: sig('B1C', 'B1C'),
    4: sig('B1A', 'B1A'),
    5: sig('B2a', 'B2a'),
    6: sig('B2b', 'B2b'),
    7: sig('B2ab', 'B2 a+b'),
    8: sig('B3I', 'B3I'),
    9: sig('B3Q', 'B3Q'),
    10: sig('B3A', 'B3A'),
    11: sig('B2I', 'B2I'),
    12: sig('B2Q', 'B2Q'),
  },
  QZSS: {
    1: sig('L1CA', 'L1 C/A'),
    2: sig('L1CD', 'L1C (D)'),
    3: sig('L1CP', 'L1C (P)'),
    4: sig('L1S', 'L1S'),
    5: sig('L2CM', 'L2C-M'),
    6: sig('L2CL', 'L2C-L'),
    7: sig('L5I', 'L5-I'),
    8: sig('L5Q', 'L5-Q'),
    9: sig('L6D', 'L6D'),
    10: sig('L6E', 'L6E'),
  },
  NAVIC: {
    1: sig('L5A', 'L5-SPS'),
    2: sig('S', 'S-SPS'),
    3: sig('L5RS', 'L5-RS'),
    4: sig('SRS', 'S-RS'),
    5: sig('L1SPS', 'L1-SPS'),
  },
  SBAS: { 1: sig('L1CA', 'L1 C/A') },
};

/** Returns undefined for signal ID 0 ("all signals" / unspecified). */
export function nmeaSignal(constellation: Constellation, signalId: number): SignalId | undefined {
  if (signalId === 0) return undefined;
  return (
    NMEA_SIGNALS[constellation]?.[signalId] ??
    sig(
      `nmea-${constellation}-${signalId.toString(16).toUpperCase()}`,
      `Signal ${signalId.toString(16).toUpperCase()}`,
    )
  );
}

interface Band {
  lo: number;
  hi: number;
  byConstellation: Partial<Record<Constellation, SignalId>>;
}

const MHZ = 1e6;
const near = (f: number): [number, number] => [(f - 1) * MHZ, (f + 1) * MHZ];

const BANDS: Band[] = [
  {
    lo: near(1575.42)[0],
    hi: near(1575.42)[1],
    byConstellation: {
      GPS: sig('L1', 'L1'),
      QZSS: sig('L1', 'L1'),
      SBAS: sig('L1', 'L1'),
      GALILEO: sig('E1', 'E1'),
      BEIDOU: sig('B1C', 'B1C'),
      NAVIC: sig('L1', 'L1'),
    },
  },
  { lo: near(1561.098)[0], hi: near(1561.098)[1], byConstellation: { BEIDOU: sig('B1I', 'B1I') } },
  { lo: 1598.0 * MHZ, hi: 1606.0 * MHZ, byConstellation: { GLONASS: sig('G1', 'G1') } },
  {
    lo: near(1227.6)[0],
    hi: near(1227.6)[1],
    byConstellation: { GPS: sig('L2', 'L2'), QZSS: sig('L2', 'L2') },
  },
  { lo: 1242.0 * MHZ, hi: 1249.0 * MHZ, byConstellation: { GLONASS: sig('G2', 'G2') } },
  {
    lo: near(1176.45)[0],
    hi: near(1176.45)[1],
    byConstellation: {
      GPS: sig('L5', 'L5'),
      QZSS: sig('L5', 'L5'),
      SBAS: sig('L5', 'L5'),
      GALILEO: sig('E5a', 'E5a'),
      BEIDOU: sig('B2a', 'B2a'),
      NAVIC: sig('L5', 'L5'),
    },
  },
  {
    lo: near(1207.14)[0],
    hi: near(1207.14)[1],
    byConstellation: { GALILEO: sig('E5b', 'E5b'), BEIDOU: sig('B2I', 'B2I/B2b') },
  },
  { lo: near(1268.52)[0], hi: near(1268.52)[1], byConstellation: { BEIDOU: sig('B3I', 'B3I') } },
  {
    lo: near(1278.75)[0],
    hi: near(1278.75)[1],
    byConstellation: { GALILEO: sig('E6', 'E6'), QZSS: sig('L6', 'L6') },
  },
  { lo: near(2492.028)[0], hi: near(2492.028)[1], byConstellation: { NAVIC: sig('S', 'S') } },
];

/** Android carrier frequency → band (±1 MHz; GLONASS FDMA uses ranges). */
export function bandFromCarrier(
  constellation: Constellation,
  carrierHz: number,
): SignalId | undefined {
  for (const band of BANDS) {
    if (carrierHz >= band.lo && carrierHz <= band.hi) {
      return band.byConstellation[constellation];
    }
  }
  return undefined;
}

/** True for a second-frequency signal (L2/L5/E5/B2/B3/E6/G2…), used for "dual-frequency" detection. */
export function isSecondFrequency(code: string): boolean {
  return /^(L2|L5|L6|E5|E6|B2|B3|G2)/.test(code);
}
