import {
  int,
  num,
  parseDate,
  parseLatLon,
  parseTime,
  type NmeaDate,
  type NmeaTime,
  type RawSentence,
} from './parser';

/** Typed NMEA sentences (requirements REQ-SER-06). Optional fields are undefined when empty. */

export interface Gga {
  type: 'GGA';
  talker: string;
  time?: NmeaTime;
  lat?: number;
  lon?: number;
  /** 0 invalid, 1 GNSS, 2 DGNSS, 3 PPS, 4 RTK fixed, 5 RTK float, 6 DR, 7 manual, 8 simulator. */
  quality?: number;
  numSv?: number;
  hdop?: number;
  altMsl?: number;
  geoidSep?: number;
  diffAge?: number;
}

export interface Rmc {
  type: 'RMC';
  talker: string;
  time?: NmeaTime;
  /** A = valid, V = warning. */
  status?: string;
  lat?: number;
  lon?: number;
  speedKnots?: number;
  courseDeg?: number;
  date?: NmeaDate;
  /** NMEA 2.3+ mode indicator (A, D, E, F, M, N, R, S). */
  mode?: string;
  /** NMEA 4.10+ navigational status. */
  navStatus?: string;
}

export interface Gsa {
  type: 'GSA';
  talker: string;
  /** M manual, A automatic. */
  opMode?: string;
  /** 1 no fix, 2 2D, 3 3D. */
  navMode?: number;
  svs: number[];
  pdop?: number;
  hdop?: number;
  vdop?: number;
  /** NMEA 4.10+ GNSS system ID. */
  systemId?: number;
}

export interface GsvSat {
  svid: number;
  elevation?: number;
  azimuth?: number;
  cn0?: number;
}

export interface Gsv {
  type: 'GSV';
  talker: string;
  numMsg: number;
  msgNum: number;
  numSv?: number;
  sats: GsvSat[];
  /** NMEA 4.10+ signal ID (0 = all/unspecified). */
  signalId?: number;
}

export interface Gll {
  type: 'GLL';
  talker: string;
  lat?: number;
  lon?: number;
  time?: NmeaTime;
  status?: string;
  mode?: string;
}

export interface Vtg {
  type: 'VTG';
  talker: string;
  courseTrueDeg?: number;
  courseMagDeg?: number;
  speedKnots?: number;
  speedKmh?: number;
  mode?: string;
}

export interface Gns {
  type: 'GNS';
  talker: string;
  time?: NmeaTime;
  lat?: number;
  lon?: number;
  /** One mode character per system (GPS, GLONASS, Galileo, BeiDou, QZSS, NavIC). */
  posMode?: string;
  numSv?: number;
  hdop?: number;
  altMsl?: number;
  geoidSep?: number;
  navStatus?: string;
}

export interface Zda {
  type: 'ZDA';
  talker: string;
  time?: NmeaTime;
  date?: NmeaDate;
}

export interface Txt {
  type: 'TXT';
  talker: string;
  numMsg?: number;
  msgNum?: number;
  /** 0 error, 1 warning, 2 notice, 7 user. */
  textId?: number;
  text: string;
}

export type NmeaSentence = Gga | Rmc | Gsa | Gsv | Gll | Vtg | Gns | Zda | Txt;

export function decodeSentence(raw: RawSentence): NmeaSentence | undefined {
  const f = raw.fields;
  const talker = raw.talker;
  switch (raw.type) {
    case 'GGA':
      return {
        type: 'GGA',
        talker,
        time: parseTime(f[0]),
        lat: parseLatLon(f[1], f[2]),
        lon: parseLatLon(f[3], f[4]),
        quality: int(f[5]),
        numSv: int(f[6]),
        hdop: num(f[7]),
        altMsl: num(f[8]),
        geoidSep: num(f[10]),
        diffAge: num(f[12]),
      };
    case 'RMC':
      return {
        type: 'RMC',
        talker,
        time: parseTime(f[0]),
        status: f[1] || undefined,
        lat: parseLatLon(f[2], f[3]),
        lon: parseLatLon(f[4], f[5]),
        speedKnots: num(f[6]),
        courseDeg: num(f[7]),
        date: parseDate(f[8]),
        mode: f[11] || undefined,
        navStatus: f[12] || undefined,
      };
    case 'GSA': {
      const svs: number[] = [];
      for (let i = 2; i < 14; i++) {
        const sv = int(f[i]);
        if (sv !== undefined && sv > 0) svs.push(sv);
      }
      return {
        type: 'GSA',
        talker,
        opMode: f[0] || undefined,
        navMode: int(f[1]),
        svs,
        pdop: num(f[14]),
        hdop: num(f[15]),
        vdop: num(f[16]),
        systemId: int(f[17], 16),
      };
    }
    case 'GSV': {
      const numMsg = int(f[0]);
      const msgNum = int(f[1]);
      if (numMsg === undefined || msgNum === undefined) return undefined;
      const rest = f.length - 3;
      // A trailing field after the satellite blocks is the 4.10+ signal ID.
      const hasSignal = rest > 0 && rest % 4 === 1;
      const blocks = Math.floor(rest / 4);
      const sats: GsvSat[] = [];
      for (let b = 0; b < blocks; b++) {
        const base = 3 + b * 4;
        const svid = int(f[base]);
        if (svid === undefined) continue;
        sats.push({
          svid,
          elevation: num(f[base + 1]),
          azimuth: num(f[base + 2]),
          cn0: num(f[base + 3]),
        });
      }
      return {
        type: 'GSV',
        talker,
        numMsg,
        msgNum,
        numSv: int(f[2]),
        sats,
        signalId: hasSignal ? int(f[f.length - 1], 16) : undefined,
      };
    }
    case 'GLL':
      return {
        type: 'GLL',
        talker,
        lat: parseLatLon(f[0], f[1]),
        lon: parseLatLon(f[2], f[3]),
        time: parseTime(f[4]),
        status: f[5] || undefined,
        mode: f[6] || undefined,
      };
    case 'VTG':
      return {
        type: 'VTG',
        talker,
        courseTrueDeg: num(f[0]),
        courseMagDeg: num(f[2]),
        speedKnots: num(f[4]),
        speedKmh: num(f[6]),
        mode: f[8] || undefined,
      };
    case 'GNS':
      return {
        type: 'GNS',
        talker,
        time: parseTime(f[0]),
        lat: parseLatLon(f[1], f[2]),
        lon: parseLatLon(f[3], f[4]),
        posMode: f[5] || undefined,
        numSv: int(f[6]),
        hdop: num(f[7]),
        altMsl: num(f[8]),
        geoidSep: num(f[9]),
        navStatus: f[12] || undefined,
      };
    case 'ZDA': {
      const day = int(f[1]);
      const month = int(f[2]);
      const year = int(f[3]);
      const date =
        day !== undefined &&
        month !== undefined &&
        year !== undefined &&
        day >= 1 &&
        month >= 1 &&
        month <= 12
          ? { day, month, year }
          : undefined;
      return { type: 'ZDA', talker, time: parseTime(f[0]), date };
    }
    case 'TXT':
      return {
        type: 'TXT',
        talker,
        numMsg: int(f[0]),
        msgNum: int(f[1]),
        textId: int(f[2]),
        text: f.slice(3).join(','),
      };
    default:
      return undefined;
  }
}
