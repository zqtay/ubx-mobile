import type { TFunction } from 'i18next';

import type { ConfigAvailability } from '@/config/availability';
import { keyName, msgoutKey, OUTPUT_MESSAGES, KEY, type CfgPort } from '@/config/keys';
import type { RuleFinding } from '@/config/rules';
import { formatSettingValue, type SectionDef, type SettingDef } from '@/config/sections';
import type { ConfigOutcome } from '@/state/configStore';

/** `t` for keys built at runtime (section definitions, rule IDs). */
export function tr(t: TFunction, key: string, options?: Record<string, unknown>): string {
  return (t as unknown as (k: string, o?: Record<string, unknown>) => string)(key, options);
}

/** Labels starting with '=' are literal (message names, signal names). */
export function settingLabel(t: TFunction, s: SettingDef): string {
  return s.label.startsWith('=') ? s.label.slice(1) : tr(t, s.label);
}

export function settingValue(t: TFunction, s: SettingDef, value: number | undefined): string {
  return formatSettingValue(s, value, [t('common.on'), t('common.off')]);
}

export function ruleMessage(t: TFunction, f: RuleFinding): string {
  return tr(t, `config.rule.${f.id}`, f.params);
}

export function unavailableMessage(t: TFunction, a: Exclude<ConfigAvailability, 'ok'>): string {
  return t(`config.unavailable.${a}`);
}

const OUTCOME_KEY: Record<string, string> = {
  'apply:applied': 'applied',
  'save:applied': 'saved',
  'revert:applied': 'reverted',
  'restart:done': 'restarted',
  'factory-reset:done': 'factoryReset',
};

/** Banner after an action (functional spec §11.3, §11.5–11.7). */
export function outcomeMessage(
  t: TFunction,
  o: ConfigOutcome,
): { tone: 'success' | 'warning' | 'danger'; message: string } {
  const success = OUTCOME_KEY[`${o.action}:${o.status}`];
  if (success) return { tone: 'success', message: tr(t, `config.outcome.${success}`) };
  switch (o.status) {
    case 'mismatch': {
      const details = o.mismatches
        .map((m) =>
          t('config.mismatchItem', {
            name: keyName(m.key),
            actual: m.actual ?? t('common.notAvailable'),
            expected: m.expected,
          }),
        )
        .join('; ');
      return { tone: 'warning', message: t('config.outcome.mismatch', { details }) };
    }
    case 'rejected':
      return { tone: 'danger', message: t('config.outcome.rejected') };
    case 'timeout':
      return { tone: 'warning', message: t('config.outcome.timeout') };
    case 'baud-failed':
      return { tone: 'warning', message: t('config.outcome.baudFailed') };
    case 'lost':
      return { tone: 'danger', message: t('config.outcome.lost') };
    default:
      return { tone: 'danger', message: t('config.outcome.failed') };
  }
}

const CONSTELLATIONS: [number, string][] = [
  [KEY.SIGNAL_GPS_ENA, 'GPS'],
  [KEY.SIGNAL_GAL_ENA, 'GAL'],
  [KEY.SIGNAL_BDS_ENA, 'BDS'],
  [KEY.SIGNAL_GLO_ENA, 'GLO'],
  [KEY.SIGNAL_QZSS_ENA, 'QZSS'],
  [KEY.SIGNAL_SBAS_ENA, 'SBAS'],
];

/** One-line summary of a section's current values for the overview (functional spec §11.2). */
export function sectionSummary(
  t: TFunction,
  section: SectionDef,
  port: CfgPort,
  values: ReadonlyMap<number, number>,
): string {
  const settings = section.settings(port);
  const show = (key: number) => {
    const s = settings.find((x) => x.key === key);
    return s && values.has(key) ? settingValue(t, s, values.get(key)) : undefined;
  };
  switch (section.id) {
    case 'rate':
      return show(KEY.RATE_MEAS) ?? '';
    case 'port': {
      const protocols = [
        values.get(port === 'USB' ? KEY.USBOUTPROT_UBX : KEY.UART1OUTPROT_UBX) ? 'UBX' : undefined,
        values.get(port === 'USB' ? KEY.USBOUTPROT_NMEA : KEY.UART1OUTPROT_NMEA)
          ? 'NMEA'
          : undefined,
      ].filter(Boolean);
      return [
        port === 'UART1' ? values.get(KEY.UART1_BAUDRATE) : 'USB',
        protocols.join('+') || undefined,
      ]
        .filter((x) => x !== undefined)
        .join(' · ');
    }
    case 'gnss': {
      const on = CONSTELLATIONS.filter(([k]) => values.get(k)).map(([, name]) => name);
      return on.length ? on.join(' ') : t('config.summary.none');
    }
    case 'messages': {
      const count = OUTPUT_MESSAGES.filter((m) => (values.get(msgoutKey(m, port)) ?? 0) > 0).length;
      return t('config.summary.messages', { count });
    }
    case 'navigation':
      return show(KEY.NAVSPG_DYNMODEL) ?? '';
    case 'nmea':
      return show(KEY.NMEA_PROTVER) ?? '';
  }
}
