import { DYN_MODELS, KEY, keyDef, msgoutKey, OUTPUT_MESSAGES, PM_MODE, type CfgPort } from './keys';
import { protocolKeys, type ConfigValues } from './rules';

/**
 * Declarative configuration sections (functional spec §11.4, technical spec §13.1): adding a
 * setting means adding a line here. Labels are i18n keys under `config.*`; a setting is only
 * shown when the receiver reports its key.
 */

export type ControlSpec =
  | { kind: 'switch' }
  | { kind: 'choice'; options: { value: number; label: string }[] }
  | { kind: 'stepper'; min: number; max: number; step?: number; unit?: string };

export interface SettingDef {
  key: number;
  /** i18n key of the label, or a literal label prefixed with '=' (e.g. message names). */
  label: string;
  /** i18n key of a one-line help text. */
  help?: string;
  control: ControlSpec;
  /** i18n key explaining why the setting cannot be changed (lock-out protection). */
  locked?: string;
  /** Indented under the previous setting (e.g. a signal of a constellation). */
  indent?: boolean;
  /** Shown only when this holds for the current + staged values (e.g. power-save settings). */
  visibleWhen?: (values: ConfigValues) => boolean;
}

export type SectionId = 'rate' | 'port' | 'gnss' | 'messages' | 'navigation' | 'nmea' | 'power';

export interface SectionDef {
  id: SectionId;
  title: string;
  icon:
    | 'timer-outline'
    | 'serial-port'
    | 'satellite-variant'
    | 'lightning-bolt-outline'
    | 'email-outline'
    | 'compass-outline'
    | 'code-tags';
  settings: (port: CfgPort) => SettingDef[];
}

const BAUDS = [9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600];
const RATES: [number, string][] = [
  [1000, '1 Hz'],
  [500, '2 Hz'],
  [200, '5 Hz'],
  [100, '10 Hz'],
];

const enumOptions = (key: number) =>
  Object.entries(keyDef(key)?.enumValues ?? {}).map(([value, label]) => ({
    value: Number(value),
    label,
  }));

const sw = { kind: 'switch' } as const;

/** Presets for CFG-PM periods (seconds); 0 = off / never retry. */
const PERIODS = [0, 5, 10, 30, 60, 120, 300, 600, 1800, 3600].map((value) => ({
  value,
  label:
    value === 0
      ? '0'
      : value < 60
        ? `${value} s`
        : value < 3600
          ? `${value / 60} min`
          : `${value / 3600} h`,
}));

const powerSave = (v: ConfigValues) => (v.get(KEY.PM_OPERATEMODE) ?? PM_MODE.FULL) !== PM_MODE.FULL;

export const SECTIONS: readonly SectionDef[] = [
  {
    id: 'rate',
    title: 'config.section.rate',
    icon: 'timer-outline',
    settings: () => [
      {
        key: KEY.RATE_MEAS,
        label: 'config.setting.measRate',
        help: 'config.help.measRate',
        control: { kind: 'choice', options: RATES.map(([value, label]) => ({ value, label })) },
      },
      {
        key: KEY.RATE_NAV,
        label: 'config.setting.navRatio',
        help: 'config.help.navRatio',
        control: { kind: 'stepper', min: 1, max: 127 },
      },
      {
        key: KEY.RATE_TIMEREF,
        label: 'config.setting.timeRef',
        control: { kind: 'choice', options: enumOptions(KEY.RATE_TIMEREF) },
      },
    ],
  },
  {
    id: 'port',
    title: 'config.section.port',
    icon: 'serial-port',
    settings: (port) => {
      const p = protocolKeys(port);
      const inNmea = port === 'USB' ? KEY.USBINPROT_NMEA : KEY.UART1INPROT_NMEA;
      return [
        ...(port === 'UART1'
          ? [
              {
                key: KEY.UART1_BAUDRATE,
                label: 'config.setting.baud',
                help: 'config.help.baud',
                control: {
                  kind: 'choice',
                  options: BAUDS.map((b) => ({ value: b, label: String(b) })),
                } as ControlSpec,
              },
            ]
          : []),
        { key: p.inUbx, label: 'config.setting.inUbx', control: sw, locked: 'config.locked.ubx' },
        { key: inNmea, label: 'config.setting.inNmea', control: sw },
        { key: p.outUbx, label: 'config.setting.outUbx', control: sw, locked: 'config.locked.ubx' },
        { key: p.outNmea, label: 'config.setting.outNmea', control: sw },
      ];
    },
  },
  {
    id: 'gnss',
    title: 'config.section.gnss',
    icon: 'satellite-variant',
    settings: () => [
      { key: KEY.SIGNAL_GPS_ENA, label: 'config.setting.gps', control: sw },
      { key: KEY.SIGNAL_GPS_L1CA_ENA, label: '=L1C/A', control: sw, indent: true },
      { key: KEY.SIGNAL_GAL_ENA, label: 'config.setting.galileo', control: sw },
      { key: KEY.SIGNAL_GAL_E1_ENA, label: '=E1', control: sw, indent: true },
      { key: KEY.SIGNAL_BDS_ENA, label: 'config.setting.beidou', control: sw },
      { key: KEY.SIGNAL_BDS_B1_ENA, label: '=B1I', control: sw, indent: true },
      { key: KEY.SIGNAL_BDS_B1C_ENA, label: '=B1C', control: sw, indent: true },
      { key: KEY.SIGNAL_GLO_ENA, label: 'config.setting.glonass', control: sw },
      { key: KEY.SIGNAL_GLO_L1_ENA, label: '=L1OF', control: sw, indent: true },
      { key: KEY.SIGNAL_QZSS_ENA, label: 'config.setting.qzss', control: sw },
      { key: KEY.SIGNAL_QZSS_L1CA_ENA, label: '=L1C/A', control: sw, indent: true },
      { key: KEY.SIGNAL_QZSS_L1S_ENA, label: '=L1S', control: sw, indent: true },
      { key: KEY.SIGNAL_SBAS_ENA, label: 'config.setting.sbas', control: sw },
      { key: KEY.SIGNAL_SBAS_L1CA_ENA, label: '=L1C/A', control: sw, indent: true },
    ],
  },
  {
    id: 'messages',
    title: 'config.section.messages',
    icon: 'email-outline',
    settings: (port) =>
      OUTPUT_MESSAGES.map((m) => ({
        key: msgoutKey(m, port),
        label: `=${m.protocol === 'UBX' ? `UBX-${m.label}` : `NMEA ${m.label}`}`,
        control: { kind: 'stepper', min: 0, max: 255, unit: 'config.unit.everyNth' },
      })),
  },
  {
    id: 'navigation',
    title: 'config.section.navigation',
    icon: 'compass-outline',
    settings: () => [
      {
        key: KEY.NAVSPG_DYNMODEL,
        label: 'config.setting.dynModel',
        help: 'config.help.dynModel',
        control: {
          kind: 'choice',
          options: Object.entries(DYN_MODELS).map(([v, l]) => ({ value: Number(v), label: l })),
        },
      },
      {
        key: KEY.NAVSPG_FIXMODE,
        label: 'config.setting.fixMode',
        control: { kind: 'choice', options: enumOptions(KEY.NAVSPG_FIXMODE) },
      },
      {
        key: KEY.NAVSPG_INFIL_MINELEV,
        label: 'config.setting.minElev',
        help: 'config.help.minElev',
        control: { kind: 'stepper', min: -10, max: 60, unit: '°' },
      },
      {
        key: KEY.NAVSPG_INFIL_MINCNO,
        label: 'config.setting.minCno',
        help: 'config.help.minCno',
        control: { kind: 'stepper', min: 0, max: 50, unit: 'dB-Hz' },
      },
      {
        key: KEY.NAVSPG_INFIL_NCNOTHRS,
        label: 'config.setting.nCnoThrs',
        control: { kind: 'stepper', min: 0, max: 32 },
      },
      {
        key: KEY.NAVSPG_UTCSTANDARD,
        label: 'config.setting.utcStandard',
        control: { kind: 'choice', options: enumOptions(KEY.NAVSPG_UTCSTANDARD) },
      },
    ],
  },
  {
    id: 'nmea',
    title: 'config.section.nmea',
    icon: 'code-tags',
    settings: () => [
      {
        key: KEY.NMEA_PROTVER,
        label: 'config.setting.nmeaVersion',
        control: { kind: 'choice', options: enumOptions(KEY.NMEA_PROTVER) },
      },
      {
        key: KEY.NMEA_SVNUMBERING,
        label: 'config.setting.svNumbering',
        control: { kind: 'choice', options: enumOptions(KEY.NMEA_SVNUMBERING) },
      },
      { key: KEY.NMEA_HIGHPREC, label: 'config.setting.highPrecision', control: sw },
      {
        key: KEY.NMEA_MAINTALKERID,
        label: 'config.setting.mainTalker',
        control: { kind: 'choice', options: enumOptions(KEY.NMEA_MAINTALKERID) },
      },
      {
        key: KEY.NMEA_GSVTALKERID,
        label: 'config.setting.gsvTalker',
        control: { kind: 'choice', options: enumOptions(KEY.NMEA_GSVTALKERID) },
      },
    ],
  },
  {
    id: 'power',
    title: 'config.section.power',
    icon: 'lightning-bolt-outline',
    settings: () => [
      {
        key: KEY.PM_OPERATEMODE,
        label: 'config.setting.powerMode',
        help: 'config.help.powerMode',
        control: {
          kind: 'choice',
          options: [PM_MODE.FULL, PM_MODE.PSMCT, PM_MODE.PSMOO].map((value) => ({
            value,
            label: keyDef(KEY.PM_OPERATEMODE)!.enumValues![value],
          })),
        },
      },
      {
        key: KEY.PM_POSUPDATEPERIOD,
        label: 'config.setting.updatePeriod',
        help: 'config.help.updatePeriod',
        control: { kind: 'choice', options: PERIODS },
        visibleWhen: powerSave,
      },
      {
        key: KEY.PM_ACQPERIOD,
        label: 'config.setting.acqPeriod',
        help: 'config.help.acqPeriod',
        control: { kind: 'choice', options: PERIODS },
        visibleWhen: powerSave,
      },
      {
        key: KEY.PM_ONTIME,
        label: 'config.setting.onTime',
        help: 'config.help.onTime',
        control: { kind: 'choice', options: PERIODS.filter((p) => p.value <= 300) },
        visibleWhen: powerSave,
      },
      {
        key: KEY.PM_MINACQTIME,
        label: 'config.setting.minAcqTime',
        control: { kind: 'stepper', min: 0, max: 255, unit: 's' },
        visibleWhen: powerSave,
      },
      {
        key: KEY.PM_MAXACQTIME,
        label: 'config.setting.maxAcqTime',
        help: 'config.help.maxAcqTime',
        control: { kind: 'stepper', min: 0, max: 255, unit: 's' },
        visibleWhen: powerSave,
      },
      {
        key: KEY.PM_DONOTENTEROFF,
        label: 'config.setting.doNotEnterOff',
        help: 'config.help.doNotEnterOff',
        control: sw,
        visibleWhen: powerSave,
      },
      {
        key: KEY.PM_WAITTIMEFIX,
        label: 'config.setting.waitTimeFix',
        control: sw,
        visibleWhen: powerSave,
      },
      {
        key: KEY.PM_UPDATEEPH,
        label: 'config.setting.updateEph',
        help: 'config.help.updateEph',
        control: sw,
        visibleWhen: powerSave,
      },
      {
        key: KEY.PM_LIMITPEAKCURR,
        label: 'config.setting.limitPeakCurrent',
        help: 'config.help.limitPeakCurrent',
        control: sw,
      },
    ],
  },
];

export function sectionById(id: string): SectionDef | undefined {
  return SECTIONS.find((s) => s.id === id);
}

/**
 * Settings of a section that the receiver reports (values loaded from RAM) and whose
 * `visibleWhen` holds for `values` (current + staged; defaults to RAM).
 */
export function availableSettings(
  section: SectionDef,
  port: CfgPort,
  ram: ConfigValues,
  values: ConfigValues = ram,
): SettingDef[] {
  return section.settings(port).filter((s) => ram.has(s.key) && (s.visibleWhen?.(values) ?? true));
}

/** All keys the configuration screens may read. */
export function allSectionKeys(port: CfgPort): number[] {
  return [...new Set(SECTIONS.flatMap((s) => s.settings(port).map((x) => x.key)))];
}

/** Display text of a value for a setting (choice label, on/off, number). */
export function formatSettingValue(
  setting: SettingDef,
  value: number | undefined,
  onOff: [string, string],
): string {
  if (value === undefined) return '—';
  const c = setting.control;
  if (c.kind === 'switch') return value ? onOff[0] : onOff[1];
  if (c.kind === 'choice') return c.options.find((o) => o.value === value)?.label ?? String(value);
  return String(value);
}

/** Definition of a setting by key, for change summaries. */
export function settingByKey(port: CfgPort, key: number): SettingDef | undefined {
  for (const s of SECTIONS) {
    const found = s.settings(port).find((x) => x.key === key);
    if (found) return found;
  }
  return undefined;
}
