import type { Constellation } from './types';

export type MarkerShape =
  'circle' | 'square' | 'triangle' | 'pentagon' | 'hexagon' | 'diamond' | 'triangle-down' | 'cross';

/** Key into the theme's `gnss` colour tokens. */
export type GnssColorToken = 'gps' | 'glo' | 'gal' | 'bds' | 'qzss' | 'navic' | 'sbas' | 'other';

export type SvLabelStyle = 'ucenter' | 'rinex';

export interface ConstellationMeta {
  id: Constellation;
  name: string;
  /** Short name for chips, e.g. "GAL". */
  short: string;
  shape: MarkerShape;
  color: GnssColorToken;
  ucenterPrefix: string;
  rinexPrefix: string;
  /** ISO country/region code for the optional flag icon. */
  flag?: 'us' | 'ru' | 'eu' | 'cn' | 'jp' | 'in';
}

/** Constellation metadata (functional spec §6.2), in display order. */
export const CONSTELLATIONS: readonly ConstellationMeta[] = [
  {
    id: 'GPS',
    name: 'GPS',
    short: 'GPS',
    shape: 'circle',
    color: 'gps',
    ucenterPrefix: 'G',
    rinexPrefix: 'G',
    flag: 'us',
  },
  {
    id: 'GLONASS',
    name: 'GLONASS',
    short: 'GLO',
    shape: 'square',
    color: 'glo',
    ucenterPrefix: 'R',
    rinexPrefix: 'R',
    flag: 'ru',
  },
  {
    id: 'GALILEO',
    name: 'Galileo',
    short: 'GAL',
    shape: 'triangle',
    color: 'gal',
    ucenterPrefix: 'E',
    rinexPrefix: 'E',
    flag: 'eu',
  },
  {
    id: 'BEIDOU',
    name: 'BeiDou',
    short: 'BDS',
    shape: 'pentagon',
    color: 'bds',
    ucenterPrefix: 'B',
    rinexPrefix: 'C',
    flag: 'cn',
  },
  {
    id: 'QZSS',
    name: 'QZSS',
    short: 'QZSS',
    shape: 'hexagon',
    color: 'qzss',
    ucenterPrefix: 'Q',
    rinexPrefix: 'J',
    flag: 'jp',
  },
  {
    id: 'NAVIC',
    name: 'NavIC',
    short: 'NavIC',
    shape: 'diamond',
    color: 'navic',
    ucenterPrefix: 'N',
    rinexPrefix: 'I',
    flag: 'in',
  },
  {
    id: 'SBAS',
    name: 'SBAS',
    short: 'SBAS',
    shape: 'triangle-down',
    color: 'sbas',
    ucenterPrefix: 'S',
    rinexPrefix: 'S',
  },
  {
    id: 'IMES',
    name: 'IMES',
    short: 'IMES',
    shape: 'cross',
    color: 'other',
    ucenterPrefix: '?',
    rinexPrefix: '?',
  },
  {
    id: 'UNKNOWN',
    name: 'Unknown',
    short: '?',
    shape: 'cross',
    color: 'other',
    ucenterPrefix: '?',
    rinexPrefix: '?',
  },
];

const byId = new Map(CONSTELLATIONS.map((c, index) => [c.id, { ...c, index }]));

export function constellationMeta(id: Constellation): ConstellationMeta {
  return byId.get(id) ?? byId.get('UNKNOWN')!;
}

/** Sort order of constellations (GPS first). */
export function constellationOrder(id: Constellation): number {
  return byId.get(id)?.index ?? CONSTELLATIONS.length;
}

/**
 * Display label for a satellite (requirements REQ-SET-02), e.g. u-center `G14`, `Q2`, `S123`
 * or RINEX `G14`, `J02`, `S23`. GLONASS satellites with an unknown slot show their frequency
 * channel, e.g. `R?-3`.
 */
export function svLabel(
  constellation: Constellation,
  svid: number,
  style: SvLabelStyle = 'ucenter',
  glonassFcn?: number,
): string {
  const meta = constellationMeta(constellation);
  const prefix = style === 'rinex' ? meta.rinexPrefix : meta.ucenterPrefix;
  if (constellation === 'GLONASS' && svid === 0 && glonassFcn !== undefined) {
    return `${prefix}?${glonassFcn >= 0 ? '+' : ''}${glonassFcn}`;
  }
  let n = svid;
  if (constellation === 'QZSS' && svid >= 193) n = svid - 192;
  if (style === 'rinex') {
    if (constellation === 'SBAS' && svid >= 100) n = svid - 100;
    return `${prefix}${String(n).padStart(2, '0')}`;
  }
  return `${prefix}${n}`;
}

/** Flag emoji for a constellation's operator (regional-indicator letters), e.g. 🇪🇺 for Galileo. */
export function flagEmoji(constellation: Constellation): string | undefined {
  const code = constellationMeta(constellation).flag;
  if (!code) return undefined;
  return String.fromCodePoint(
    ...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65),
  );
}
