import type { Constellation, SatKey } from './types';

/**
 * Satellite identity normalisation (technical spec §6.3). Every source maps its numbering to
 * `(constellation, svid)` using the constellation's native numbering:
 * GPS PRN 1–32, SBAS PRN 120–158, Galileo 1–36, BeiDou 1–63, QZSS PRN 193–202,
 * GLONASS slot 1–24 (or frequency channel when the slot is unknown), NavIC 1–14, IMES 1–10.
 */
export interface SatId {
  constellation: Constellation;
  /** Native number; 0 for a GLONASS satellite whose slot is unknown (see `glonassFcn`). */
  svid: number;
  glonassFcn?: number;
}

export function satKey(constellation: Constellation, svid: number, glonassFcn?: number): SatKey {
  if (constellation === 'GLONASS' && svid === 0) {
    return glonassFcn === undefined ? 'GLONASS:unknown' : `GLONASS:fcn${glonassFcn}`;
  }
  return `${constellation}:${svid}`;
}

export function keyOf(id: SatId): SatKey {
  return satKey(id.constellation, id.svid, id.glonassFcn);
}

const UBX_GNSS: Record<number, Constellation> = {
  0: 'GPS',
  1: 'SBAS',
  2: 'GALILEO',
  3: 'BEIDOU',
  4: 'IMES',
  5: 'QZSS',
  6: 'GLONASS',
  7: 'NAVIC',
};

export function ubxGnssToConstellation(gnssId: number): Constellation {
  return UBX_GNSS[gnssId] ?? 'UNKNOWN';
}

/**
 * UBX gnssId/svId (NAV-SAT, NAV-SIG). `freqId` (NAV-SIG, GLONASS only) is the frequency
 * channel + 7 and identifies a satellite whose slot is unknown (svId 255).
 */
export function fromUbx(gnssId: number, svId: number, freqId?: number): SatId {
  const constellation = ubxGnssToConstellation(gnssId);
  if (constellation === 'QZSS' && svId >= 1 && svId <= 10) {
    return { constellation, svid: svId + 192 };
  }
  if (constellation === 'GLONASS' && (svId === 255 || svId === 0)) {
    return { constellation, svid: 0, glonassFcn: freqId === undefined ? undefined : freqId - 7 };
  }
  return { constellation, svid: svId };
}

/** Legacy UBX NAV-SVINFO numbering (u-blox 6/7/8). */
export function fromUbxLegacy(svid: number): SatId {
  if (svid >= 1 && svid <= 32) return { constellation: 'GPS', svid };
  if (svid >= 33 && svid <= 64) return { constellation: 'BEIDOU', svid: svid - 27 }; // PRN 6–37
  if (svid >= 65 && svid <= 96) return { constellation: 'GLONASS', svid: svid - 64 };
  if (svid >= 120 && svid <= 158) return { constellation: 'SBAS', svid };
  if (svid >= 159 && svid <= 163) return { constellation: 'BEIDOU', svid: svid - 158 }; // PRN 1–5
  if (svid >= 173 && svid <= 182) return { constellation: 'IMES', svid: svid - 172 };
  if (svid >= 193 && svid <= 202) return { constellation: 'QZSS', svid };
  if (svid >= 211 && svid <= 246) return { constellation: 'GALILEO', svid: svid - 210 };
  if (svid === 255) return { constellation: 'GLONASS', svid: 0 };
  return { constellation: 'UNKNOWN', svid };
}

/** android.location.GnssStatus.CONSTELLATION_* values. */
const ANDROID_GNSS: Record<number, Constellation> = {
  1: 'GPS',
  2: 'SBAS',
  3: 'GLONASS',
  4: 'QZSS',
  5: 'BEIDOU',
  6: 'GALILEO',
  7: 'NAVIC',
};

export function fromAndroid(constellationType: number, svid: number): SatId {
  const constellation = ANDROID_GNSS[constellationType] ?? 'UNKNOWN';
  if (constellation === 'GLONASS' && svid >= 93 && svid <= 106) {
    // Frequency channel number + 100 when the slot number is unknown.
    return { constellation, svid: 0, glonassFcn: svid - 100 };
  }
  if (constellation === 'QZSS' && svid >= 1 && svid <= 10) {
    return { constellation, svid: svid + 192 };
  }
  return { constellation, svid };
}

/** NMEA 0183 v4.10+ system ID (GSA, GNS) → constellation. */
const NMEA_SYSTEM: Record<number, Constellation> = {
  1: 'GPS',
  2: 'GLONASS',
  3: 'GALILEO',
  4: 'BEIDOU',
  5: 'QZSS',
  6: 'NAVIC',
};

export function nmeaSystemToConstellation(systemId: number): Constellation | undefined {
  return NMEA_SYSTEM[systemId];
}

const TALKER: Record<string, Constellation> = {
  GP: 'GPS',
  GL: 'GLONASS',
  GA: 'GALILEO',
  GB: 'BEIDOU',
  BD: 'BEIDOU',
  GQ: 'QZSS',
  QZ: 'QZSS',
  GI: 'NAVIC',
  IR: 'NAVIC',
};

/** Constellation implied by an NMEA talker ID; undefined for multi-system talkers such as GN. */
export function talkerToConstellation(talker: string): Constellation | undefined {
  return TALKER[talker];
}

/**
 * Resolve an NMEA satellite number. Uses the 4.10+ system ID when present, otherwise the
 * talker, otherwise the "extended" numbering ranges used by u-blox NMEA 4.0 mode and others.
 * Returns undefined for numbers that cannot be mapped.
 */
export function fromNmea(talker: string, n: number, systemId?: number): SatId | undefined {
  if (!Number.isFinite(n) || n <= 0) return undefined;
  const bySystem = systemId !== undefined ? nmeaSystemToConstellation(systemId) : undefined;
  const constellation = bySystem ?? talkerToConstellation(talker);

  switch (constellation) {
    case 'GPS':
      // GP talker also carries SBAS and QZSS in extended numbering.
      if (n <= 32) return { constellation: 'GPS', svid: n };
      return fromExtended(n);
    case 'GLONASS':
      if (n >= 65 && n <= 96) return { constellation, svid: n - 64 };
      if (n <= 24) return { constellation, svid: n };
      return undefined;
    case 'GALILEO':
      if (n >= 301 && n <= 336) return { constellation, svid: n - 300 };
      if (n <= 36) return { constellation, svid: n };
      return undefined;
    case 'BEIDOU':
      if (n >= 401 && n <= 463) return { constellation, svid: n - 400 };
      if (n >= 201 && n <= 263) return { constellation, svid: n - 200 };
      if (n <= 63) return { constellation, svid: n };
      return undefined;
    case 'QZSS':
      if (n >= 193 && n <= 202) return { constellation, svid: n };
      if (n <= 10) return { constellation, svid: n + 192 };
      return undefined;
    case 'NAVIC':
      if (n <= 14) return { constellation, svid: n };
      return undefined;
    default:
      return fromExtended(n);
  }
}

/**
 * "Extended" NMEA numbering: GPS 1–32, SBAS 33–64 (PRN − 87) and 152–158, GLONASS 65–96,
 * IMES 173–182, QZSS 193–202, BeiDou 203–263 (vendor 201+ scheme; 201–202 resolve to QZSS),
 * Galileo 301–336, BeiDou 401–437.
 */
function fromExtended(n: number): SatId | undefined {
  if (n >= 1 && n <= 32) return { constellation: 'GPS', svid: n };
  if (n >= 33 && n <= 64) return { constellation: 'SBAS', svid: n + 87 };
  if (n >= 65 && n <= 96) return { constellation: 'GLONASS', svid: n - 64 };
  if (n >= 120 && n <= 158) return { constellation: 'SBAS', svid: n };
  if (n >= 173 && n <= 182) return { constellation: 'IMES', svid: n - 172 };
  if (n >= 193 && n <= 202) return { constellation: 'QZSS', svid: n };
  if (n >= 203 && n <= 263) return { constellation: 'BEIDOU', svid: n - 200 };
  if (n >= 301 && n <= 336) return { constellation: 'GALILEO', svid: n - 300 };
  if (n >= 401 && n <= 463) return { constellation: 'BEIDOU', svid: n - 400 };
  return undefined;
}
