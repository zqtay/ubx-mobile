import type { GnssEvent } from '@/domain/events';
import { fromUbx, fromUbxLegacy, keyOf } from '@/domain/satKey';
import { ubxSignal } from '@/domain/signals';
import type {
  AntennaPower,
  AntennaStatus,
  CarrierSolution,
  Constellation,
  FixType,
  Health,
  InfoLevel,
  JammingState,
  OrbitSource,
  ReceiverInfo,
  RfBlockInfo,
  SatObservation,
} from '@/domain/types';

import { isMessage, UBX } from './ids';
import {
  CORR_SOURCES,
  decodeInf,
  decodeMonGnss,
  decodeMonHw,
  decodeMonRf,
  decodeMonVer,
  decodeNavDop,
  decodeNavPvt,
  decodeNavSat,
  decodeNavSig,
  decodeNavStatus,
  decodeNavTimeLs,
  decodeNavSvInfo,
  decodeSecUniqId,
  type MonVer,
  type NavSatSv,
  type RfBlock,
} from './messages';

const FIX_TYPES: Record<number, FixType> = {
  0: 'none',
  1: 'dead-reckoning',
  2: '2d',
  3: '3d',
  4: 'gnss-dr',
  5: 'time-only',
};
const CARRIER: Record<number, CarrierSolution> = { 0: 'none', 1: 'float', 2: 'fixed' };
const HEALTH: Record<number, Health> = { 0: 'unknown', 1: 'healthy', 2: 'unhealthy' };
const ORBIT: Record<number, OrbitSource> = {
  0: 'none',
  1: 'ephemeris',
  2: 'almanac',
  3: 'assistnow-offline',
  4: 'assistnow-autonomous',
};
const ANT_STATUS: Record<number, AntennaStatus> = {
  0: 'init',
  1: 'unknown',
  2: 'ok',
  3: 'short',
  4: 'open',
};
const ANT_POWER: Record<number, AntennaPower> = { 0: 'off', 1: 'on', 2: 'unknown' };
const JAMMING: Record<number, JammingState> = {
  0: 'unknown',
  1: 'ok',
  2: 'warning',
  3: 'critical',
};
const INF_LEVEL: Record<number, InfoLevel> = {
  0: 'error',
  1: 'warning',
  2: 'notice',
  3: 'debug',
  4: 'debug',
};
const INF_NAME: Record<number, string> = {
  0: 'ERROR',
  1: 'WARNING',
  2: 'NOTICE',
  3: 'TEST',
  4: 'DEBUG',
};
/** MON-GNSS / MON-VER constellation bits and names. */
const GNSS_BITS: [number, Constellation][] = [
  [0, 'GPS'],
  [1, 'GLONASS'],
  [2, 'BEIDOU'],
  [3, 'GALILEO'],
];
const GNSS_NAMES: Record<string, Constellation> = {
  GPS: 'GPS',
  GLO: 'GLONASS',
  GAL: 'GALILEO',
  BDS: 'BEIDOU',
  SBAS: 'SBAS',
  QZSS: 'QZSS',
  NAVIC: 'NAVIC',
  IMES: 'IMES',
};

/**
 * Turns UBX frames into normalised events (technical spec §6.5, §7.1). ACK/NAK and CFG
 * responses are not handled here; the UbxClient (M4) consumes them directly.
 */
export function interpretUbx(
  cls: number,
  id: number,
  payload: Uint8Array,
  rxMs: number,
): GnssEvent[] {
  if (isMessage(cls, id, UBX.NAV_PVT)) {
    const m = decodeNavPvt(payload);
    if (!m) return [];
    const fixType = FIX_TYPES[m.fixType] ?? 'none';
    const hasPosition = fixType !== 'none' && fixType !== 'time-only';
    const events: GnssEvent[] = [
      {
        t: 'fix',
        origin: 'ubx',
        fix: {
          fixType,
          fixOk: m.gnssFixOk,
          differential: m.diffSoln,
          carrierSolution: CARRIER[m.carrSoln] ?? 'none',
          numSvUsed: m.numSV,
          ...(hasPosition
            ? {
                lat: m.latDeg,
                lon: m.lonDeg,
                altEllipsoidM: m.heightM,
                altMslM: m.hMslM,
                hAccM: m.hAccM,
                vAccM: m.vAccM,
                speedMps: m.gSpeedMps,
                speedAccMps: m.sAccMps,
                courseDeg: m.headMotDeg,
                courseAccDeg: m.headAccDeg,
              }
            : {}),
          utc:
            m.validTime || m.validDate
              ? {
                  epochMs:
                    Date.UTC(m.year, m.month - 1, m.day, m.hour, m.min, m.sec) +
                    Math.round(m.nanoNs / 1e6),
                  dateValid: m.validDate,
                  timeValid: m.validTime,
                  fullyResolved: m.fullyResolved,
                }
              : undefined,
        },
      },
    ];
    if (m.pDop > 0) events.push({ t: 'dop', origin: 'ubx', dop: { p: m.pDop } });
    return events;
  }

  if (isMessage(cls, id, UBX.NAV_SAT)) {
    const m = decodeNavSat(payload);
    if (!m) return [];
    return [
      { t: 'satellites', origin: 'ubx-nav-sat', scope: 'all', sats: m.svs.map(navSatObservation) },
    ];
  }

  if (isMessage(cls, id, UBX.NAV_SIG)) {
    const m = decodeNavSig(payload);
    if (!m) return [];
    return [
      {
        t: 'signals',
        signals: m.signals.map((s) => {
          const sat = fromUbx(s.gnssId, s.svId, s.gnssId === 6 ? s.freqId : undefined);
          return {
            key: keyOf(sat),
            ...sat,
            ...ubxSignal(s.gnssId, s.sigId),
            cn0: s.cno,
            quality: s.qualityInd,
            used: s.prUsed,
            prResidualM: s.prResM,
            health: HEALTH[s.health] ?? 'unknown',
            corrSource: CORR_SOURCES[s.corrSource],
            lastSeenMs: rxMs,
          };
        }),
      },
    ];
  }

  if (isMessage(cls, id, UBX.NAV_DOP)) {
    const m = decodeNavDop(payload);
    if (!m) return [];
    return [
      {
        t: 'dop',
        origin: 'ubx',
        dop: { g: m.gDop, p: m.pDop, t: m.tDop, v: m.vDop, h: m.hDop, n: m.nDop, e: m.eDop },
      },
    ];
  }

  if (isMessage(cls, id, UBX.NAV_STATUS)) {
    const m = decodeNavStatus(payload);
    if (!m || m.ttffMs <= 0) return [];
    return [{ t: 'ttff', ms: m.ttffMs }];
  }

  if (isMessage(cls, id, UBX.NAV_TIMELS)) {
    const m = decodeNavTimeLs(payload);
    if (!m) return [];
    return [
      {
        t: 'fix',
        origin: 'ubx',
        fix: { leapSeconds: m.currLs, leapSecondsValid: m.validCurrLs },
      },
    ];
  }

  if (isMessage(cls, id, UBX.NAV_SVINFO)) {
    const m = decodeNavSvInfo(payload);
    if (!m) return [];
    const sats: SatObservation[] = m.svs.map((s) => {
      const sat = fromUbxLegacy(s.svid);
      const hasPosition =
        s.orbitAvail && s.elev >= -90 && s.elev <= 90 && s.azim >= 0 && s.azim <= 360;
      return {
        key: keyOf(sat),
        ...sat,
        cn0: s.cno,
        elevation: hasPosition ? s.elev : undefined,
        azimuth: hasPosition ? s.azim : undefined,
        used: s.svUsed,
        hasEphemeris: s.orbitEph,
        hasAlmanac: s.orbitAlm,
        hasAop: s.orbitAop,
        health: s.unhealthy ? 'unhealthy' : undefined,
        quality: s.quality,
        prResidualM: s.prResM,
        diffCorr: s.diffCorr,
        smoothed: s.smoothed,
      };
    });
    return [{ t: 'satellites', origin: 'ubx-nav-svinfo', scope: 'all', sats }];
  }

  if (isMessage(cls, id, UBX.MON_VER)) {
    const m = decodeMonVer(payload);
    return m ? [{ t: 'receiver', patch: receiverFromMonVer(m) }] : [];
  }

  if (isMessage(cls, id, UBX.MON_HW)) {
    const m = decodeMonHw(payload);
    return m ? [{ t: 'receiver', patch: { ubxDetected: true, rf: [rfInfo(m)] } }] : [];
  }

  if (isMessage(cls, id, UBX.MON_RF)) {
    const m = decodeMonRf(payload);
    return m ? [{ t: 'receiver', patch: { ubxDetected: true, rf: m.map(rfInfo) } }] : [];
  }

  if (isMessage(cls, id, UBX.MON_GNSS)) {
    const m = decodeMonGnss(payload);
    if (!m) return [];
    return [
      {
        t: 'receiver',
        patch: {
          gnssSupported: fromBits(m.supported),
          gnssDefault: fromBits(m.defaultGnss),
          gnssEnabled: fromBits(m.enabled),
          maxConcurrentGnss: m.simultaneous,
        },
      },
    ];
  }

  if (isMessage(cls, id, UBX.SEC_UNIQID)) {
    const uniqueId = decodeSecUniqId(payload);
    return uniqueId ? [{ t: 'receiver', patch: { uniqueId } }] : [];
  }

  if (cls === UBX.INF_ERROR[0] && id <= 4) {
    const text = decodeInf(payload);
    return text
      ? [{ t: 'info', level: INF_LEVEL[id], text, origin: `UBX-INF-${INF_NAME[id]}` }]
      : [];
  }

  return [];
}

function navSatObservation(s: NavSatSv): SatObservation {
  const sat = fromUbx(s.gnssId, s.svId);
  const hasPosition =
    s.orbitSource !== 0 && s.elev >= -90 && s.elev <= 90 && s.azim >= 0 && s.azim <= 360;
  return {
    key: keyOf(sat),
    ...sat,
    cn0: s.cno,
    elevation: hasPosition ? s.elev : undefined,
    azimuth: hasPosition ? s.azim : undefined,
    used: s.svUsed,
    hasEphemeris: s.ephAvail,
    hasAlmanac: s.almAvail,
    hasAno: s.anoAvail,
    hasAop: s.aopAvail,
    health: HEALTH[s.health] ?? 'unknown',
    quality: s.qualityInd,
    prResidualM: s.prResM,
    orbitSource: ORBIT[s.orbitSource] ?? 'other',
    diffCorr: s.diffCorr,
    smoothed: s.smoothed,
    corrections: {
      sbas: s.sbasCorrUsed,
      rtcm: s.rtcmCorrUsed,
      slas: s.slasCorrUsed,
      spartn: s.spartnCorrUsed,
      clas: s.clasCorrUsed,
    },
  };
}

function rfInfo(b: RfBlock): RfBlockInfo {
  return {
    blockId: b.blockId,
    antennaStatus: ANT_STATUS[b.antStatus],
    antennaPower: ANT_POWER[b.antPower],
    jammingState: JAMMING[b.jammingState],
    jamIndicator: b.jamInd,
    noisePerMs: b.noisePerMS,
    agcPercent: Math.round((b.agcCnt / 8191) * 1000) / 10,
  };
}

function fromBits(mask: number): Constellation[] {
  return GNSS_BITS.filter(([b]) => (mask >> b) & 1).map(([, c]) => c);
}

/** Parses MON-VER: `FWVER=`, `PROTVER=`, `MOD=` and constellation lists such as `GPS;GLO;GAL;BDS`. */
export function receiverFromMonVer(m: MonVer): Partial<ReceiverInfo> {
  const patch: Partial<ReceiverInfo> = {
    vendor: 'u-blox',
    ubxDetected: true,
    swVersion: m.swVersion,
    hwVersion: m.hwVersion,
    extensions: m.extensions,
  };
  const supported: Constellation[] = [];
  for (const ext of m.extensions) {
    const [key, ...rest] = ext.split('=');
    const value = rest.join('=').trim();
    if (key === 'FWVER') patch.fwVersion = value;
    else if (key === 'PROTVER') patch.protocolVersion = value;
    else if (key === 'MOD') patch.module = value;
    else if (!ext.includes('=')) {
      const tokens = ext
        .split(';')
        .map((t) => t.trim())
        .filter(Boolean);
      if (tokens.length > 0 && tokens.every((t) => t in GNSS_NAMES)) {
        for (const t of tokens)
          if (!supported.includes(GNSS_NAMES[t])) supported.push(GNSS_NAMES[t]);
      }
    }
  }
  if (supported.length > 0) patch.gnssSupported = supported;
  return patch;
}
