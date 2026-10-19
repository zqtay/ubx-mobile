/**
 * Configuration keys used by the app (technical spec §13.1). IDs follow the u-blox
 * interface description for M10 (SPG 5.x) and were cross-checked against real module dumps
 * (docs/examples/*-dump.txt): every key below appears there with a plausible value.
 * At runtime, settings whose keys the connected receiver does not report are hidden.
 */

export type CfgType =
  | 'L'
  | 'U1'
  | 'U2'
  | 'U4'
  | 'U8'
  | 'I1'
  | 'I2'
  | 'I4'
  | 'I8'
  | 'E1'
  | 'E2'
  | 'E4'
  | 'X1'
  | 'X2'
  | 'X4'
  | 'X8'
  | 'R4'
  | 'R8';

export interface CfgKeyDef {
  id: number;
  name: string;
  type: CfgType;
  unit?: string;
  /** Allowed values of E-types, with labels. */
  enumValues?: Record<number, string>;
}

const def = (
  id: number,
  name: string,
  type: CfgType,
  extra: Partial<CfgKeyDef> = {},
): CfgKeyDef => ({
  id,
  name,
  type,
  ...extra,
});

/** Serial port the app is connected through; decides which port-specific keys are edited. */
export type CfgPort = 'UART1' | 'USB';

/** Offsets of port variants from a CFG-MSGOUT key's I2C ID (I2C, UART1, UART2, USB, SPI). */
const MSGOUT_OFFSET: Record<CfgPort, number> = { UART1: 1, USB: 3 };

export interface OutputMessage {
  /** e.g. 'UBX-NAV-PVT', 'NMEA GGA'. */
  label: string;
  protocol: 'NMEA' | 'UBX';
  /** CFG-MSGOUT key ID for the I2C port. */
  i2cKey: number;
  /** Typical size in bytes, for the throughput estimate (rules.ts). */
  bytes: number;
}

export const OUTPUT_MESSAGES: readonly OutputMessage[] = [
  { label: 'GGA', protocol: 'NMEA', i2cKey: 0x209100ba, bytes: 75 },
  { label: 'GLL', protocol: 'NMEA', i2cKey: 0x209100c9, bytes: 50 },
  { label: 'GSA', protocol: 'NMEA', i2cKey: 0x209100bf, bytes: 330 },
  { label: 'GSV', protocol: 'NMEA', i2cKey: 0x209100c4, bytes: 700 },
  { label: 'RMC', protocol: 'NMEA', i2cKey: 0x209100ab, bytes: 70 },
  { label: 'VTG', protocol: 'NMEA', i2cKey: 0x209100b0, bytes: 40 },
  { label: 'ZDA', protocol: 'NMEA', i2cKey: 0x209100d8, bytes: 40 },
  { label: 'GNS', protocol: 'NMEA', i2cKey: 0x209100b5, bytes: 75 },
  { label: 'GST', protocol: 'NMEA', i2cKey: 0x209100d3, bytes: 70 },
  { label: 'NAV-PVT', protocol: 'UBX', i2cKey: 0x20910006, bytes: 100 },
  { label: 'NAV-SAT', protocol: 'UBX', i2cKey: 0x20910015, bytes: 400 },
  { label: 'NAV-SIG', protocol: 'UBX', i2cKey: 0x20910345, bytes: 520 },
  { label: 'NAV-DOP', protocol: 'UBX', i2cKey: 0x20910038, bytes: 26 },
  { label: 'NAV-STATUS', protocol: 'UBX', i2cKey: 0x2091001a, bytes: 24 },
  { label: 'NAV-TIMEUTC', protocol: 'UBX', i2cKey: 0x2091005b, bytes: 28 },
];

export function msgoutKey(message: OutputMessage, port: CfgPort): number {
  return message.i2cKey + MSGOUT_OFFSET[port];
}

export const KEY = {
  RATE_MEAS: 0x30210001,
  RATE_NAV: 0x30210002,
  RATE_TIMEREF: 0x20210003,
  UART1_BAUDRATE: 0x40520001,
  UART1INPROT_UBX: 0x10730001,
  UART1INPROT_NMEA: 0x10730002,
  UART1OUTPROT_UBX: 0x10740001,
  UART1OUTPROT_NMEA: 0x10740002,
  USBINPROT_UBX: 0x10770001,
  USBINPROT_NMEA: 0x10770002,
  USBOUTPROT_UBX: 0x10780001,
  USBOUTPROT_NMEA: 0x10780002,
  SIGNAL_GPS_ENA: 0x1031001f,
  SIGNAL_GPS_L1CA_ENA: 0x10310001,
  SIGNAL_SBAS_ENA: 0x10310020,
  SIGNAL_SBAS_L1CA_ENA: 0x10310005,
  SIGNAL_GAL_ENA: 0x10310021,
  SIGNAL_GAL_E1_ENA: 0x10310007,
  SIGNAL_BDS_ENA: 0x10310022,
  SIGNAL_BDS_B1_ENA: 0x1031000d,
  SIGNAL_BDS_B1C_ENA: 0x1031000f,
  SIGNAL_QZSS_ENA: 0x10310024,
  SIGNAL_QZSS_L1CA_ENA: 0x10310012,
  SIGNAL_QZSS_L1S_ENA: 0x10310014,
  SIGNAL_GLO_ENA: 0x10310025,
  SIGNAL_GLO_L1_ENA: 0x10310018,
  NAVSPG_FIXMODE: 0x20110011,
  NAVSPG_UTCSTANDARD: 0x2011001c,
  NAVSPG_DYNMODEL: 0x20110021,
  NAVSPG_INFIL_MINSVS: 0x201100a1,
  NAVSPG_INFIL_MAXSVS: 0x201100a2,
  NAVSPG_INFIL_MINCNO: 0x201100a3,
  NAVSPG_INFIL_MINELEV: 0x201100a4,
  NAVSPG_INFIL_NCNOTHRS: 0x201100aa,
  NMEA_PROTVER: 0x20930001,
  NMEA_HIGHPREC: 0x10930006,
  NMEA_SVNUMBERING: 0x20930007,
  NMEA_MAINTALKERID: 0x20930031,
  NMEA_GSVTALKERID: 0x20930032,
} as const;

export const DYN_MODELS: Record<number, string> = {
  0: 'Portable',
  2: 'Stationary',
  3: 'Pedestrian',
  4: 'Automotive',
  5: 'Sea',
  6: 'Airborne <1g',
  7: 'Airborne <2g',
  8: 'Airborne <4g',
  9: 'Wrist',
  10: 'Bike',
  11: 'Lawn mower',
  12: 'E-scooter',
};

const KEY_DEFS: CfgKeyDef[] = [
  def(KEY.RATE_MEAS, 'CFG-RATE-MEAS', 'U2', { unit: 'ms' }),
  def(KEY.RATE_NAV, 'CFG-RATE-NAV', 'U2', { unit: 'cycles' }),
  def(KEY.RATE_TIMEREF, 'CFG-RATE-TIMEREF', 'E1', {
    enumValues: { 0: 'UTC', 1: 'GPS', 2: 'GLONASS', 3: 'BeiDou', 4: 'Galileo', 5: 'NavIC' },
  }),
  def(KEY.UART1_BAUDRATE, 'CFG-UART1-BAUDRATE', 'U4', { unit: 'Bd' }),
  def(KEY.UART1INPROT_UBX, 'CFG-UART1INPROT-UBX', 'L'),
  def(KEY.UART1INPROT_NMEA, 'CFG-UART1INPROT-NMEA', 'L'),
  def(KEY.UART1OUTPROT_UBX, 'CFG-UART1OUTPROT-UBX', 'L'),
  def(KEY.UART1OUTPROT_NMEA, 'CFG-UART1OUTPROT-NMEA', 'L'),
  def(KEY.USBINPROT_UBX, 'CFG-USBINPROT-UBX', 'L'),
  def(KEY.USBINPROT_NMEA, 'CFG-USBINPROT-NMEA', 'L'),
  def(KEY.USBOUTPROT_UBX, 'CFG-USBOUTPROT-UBX', 'L'),
  def(KEY.USBOUTPROT_NMEA, 'CFG-USBOUTPROT-NMEA', 'L'),
  def(KEY.SIGNAL_GPS_ENA, 'CFG-SIGNAL-GPS_ENA', 'L'),
  def(KEY.SIGNAL_GPS_L1CA_ENA, 'CFG-SIGNAL-GPS_L1CA_ENA', 'L'),
  def(KEY.SIGNAL_SBAS_ENA, 'CFG-SIGNAL-SBAS_ENA', 'L'),
  def(KEY.SIGNAL_SBAS_L1CA_ENA, 'CFG-SIGNAL-SBAS_L1CA_ENA', 'L'),
  def(KEY.SIGNAL_GAL_ENA, 'CFG-SIGNAL-GAL_ENA', 'L'),
  def(KEY.SIGNAL_GAL_E1_ENA, 'CFG-SIGNAL-GAL_E1_ENA', 'L'),
  def(KEY.SIGNAL_BDS_ENA, 'CFG-SIGNAL-BDS_ENA', 'L'),
  def(KEY.SIGNAL_BDS_B1_ENA, 'CFG-SIGNAL-BDS_B1_ENA', 'L'),
  def(KEY.SIGNAL_BDS_B1C_ENA, 'CFG-SIGNAL-BDS_B1C_ENA', 'L'),
  def(KEY.SIGNAL_QZSS_ENA, 'CFG-SIGNAL-QZSS_ENA', 'L'),
  def(KEY.SIGNAL_QZSS_L1CA_ENA, 'CFG-SIGNAL-QZSS_L1CA_ENA', 'L'),
  def(KEY.SIGNAL_QZSS_L1S_ENA, 'CFG-SIGNAL-QZSS_L1S_ENA', 'L'),
  def(KEY.SIGNAL_GLO_ENA, 'CFG-SIGNAL-GLO_ENA', 'L'),
  def(KEY.SIGNAL_GLO_L1_ENA, 'CFG-SIGNAL-GLO_L1_ENA', 'L'),
  def(KEY.NAVSPG_FIXMODE, 'CFG-NAVSPG-FIXMODE', 'E1', {
    enumValues: { 1: '2D only', 2: '3D only', 3: 'Auto 2D/3D' },
  }),
  def(KEY.NAVSPG_UTCSTANDARD, 'CFG-NAVSPG-UTCSTANDARD', 'E1', {
    enumValues: {
      0: 'Automatic',
      3: 'USNO (GPS)',
      5: 'EU (Galileo)',
      6: 'SU (GLONASS)',
      7: 'NTSC (BeiDou)',
    },
  }),
  def(KEY.NAVSPG_DYNMODEL, 'CFG-NAVSPG-DYNMODEL', 'E1', { enumValues: DYN_MODELS }),
  def(KEY.NAVSPG_INFIL_MINSVS, 'CFG-NAVSPG-INFIL_MINSVS', 'U1'),
  def(KEY.NAVSPG_INFIL_MAXSVS, 'CFG-NAVSPG-INFIL_MAXSVS', 'U1'),
  def(KEY.NAVSPG_INFIL_MINCNO, 'CFG-NAVSPG-INFIL_MINCNO', 'U1', { unit: 'dB-Hz' }),
  def(KEY.NAVSPG_INFIL_MINELEV, 'CFG-NAVSPG-INFIL_MINELEV', 'I1', { unit: '°' }),
  def(KEY.NAVSPG_INFIL_NCNOTHRS, 'CFG-NAVSPG-INFIL_NCNOTHRS', 'U1'),
  def(KEY.NMEA_PROTVER, 'CFG-NMEA-PROTVER', 'E1', {
    enumValues: { 21: '2.1', 23: '2.3', 40: '4.0', 41: '4.10', 42: '4.11' },
  }),
  def(KEY.NMEA_HIGHPREC, 'CFG-NMEA-HIGHPREC', 'L'),
  def(KEY.NMEA_SVNUMBERING, 'CFG-NMEA-SVNUMBERING', 'E1', {
    enumValues: { 0: 'Strict', 1: 'Extended' },
  }),
  def(KEY.NMEA_MAINTALKERID, 'CFG-NMEA-MAINTALKERID', 'E1', {
    enumValues: { 0: 'Auto', 1: 'GP', 2: 'GL', 3: 'GN', 4: 'GA', 5: 'GB', 7: 'GQ' },
  }),
  def(KEY.NMEA_GSVTALKERID, 'CFG-NMEA-GSVTALKERID', 'E1', {
    enumValues: { 0: 'Per GNSS', 1: 'Main talker' },
  }),
  ...OUTPUT_MESSAGES.flatMap((m) =>
    (['UART1', 'USB'] as const).map((port) =>
      def(
        msgoutKey(m, port),
        `CFG-MSGOUT-${m.protocol === 'UBX' ? `UBX_${m.label.replace('-', '_')}` : `NMEA_ID_${m.label}`}_${port}`,
        'U1',
      ),
    ),
  ),
];

const BY_ID = new Map(KEY_DEFS.map((d) => [d.id, d]));

export function keyDef(id: number): CfgKeyDef | undefined {
  return BY_ID.get(id);
}

export function allKnownKeys(): number[] {
  return KEY_DEFS.map((d) => d.id);
}

export function keyName(id: number): string {
  return BY_ID.get(id)?.name ?? `0x${id.toString(16).toUpperCase().padStart(8, '0')}`;
}
