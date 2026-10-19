import { KEY, msgoutKey, OUTPUT_MESSAGES, PM_MODE, type CfgPort } from './keys';

/**
 * Checks on a proposed configuration before Apply (technical spec §13.4). Errors block Apply;
 * warnings are shown but the user may continue (the receiver's NAK is the final word).
 */

export type RuleId =
  | 'lockoutUbxIn'
  | 'lockoutUbxOut'
  | 'lockoutNoOutput'
  | 'noConstellation'
  | 'throughput'
  | 'rateHigh'
  | 'rateInvalid'
  | 'powerSaveRate'
  | 'powerSaveSleep';

export interface RuleFinding {
  id: RuleId;
  severity: 'error' | 'warning';
  /** Values for the message template. */
  params?: Record<string, string | number>;
}

export type ConfigValues = ReadonlyMap<number, number>;

export function protocolKeys(port: CfgPort) {
  return port === 'USB'
    ? { inUbx: KEY.USBINPROT_UBX, outUbx: KEY.USBOUTPROT_UBX, outNmea: KEY.USBOUTPROT_NMEA }
    : { inUbx: KEY.UART1INPROT_UBX, outUbx: KEY.UART1OUTPROT_UBX, outNmea: KEY.UART1OUTPROT_NMEA };
}

/** Navigation solutions per second. */
export function navRateHz(values: ConfigValues): number | undefined {
  const meas = values.get(KEY.RATE_MEAS);
  const nav = values.get(KEY.RATE_NAV) ?? 1;
  if (!meas || nav <= 0) return undefined;
  return 1000 / meas / nav;
}

/** Estimated output in bytes per second from enabled messages × output rate (FS §11.7). */
export function estimatedOutputBytesPerSecond(values: ConfigValues, port: CfgPort): number {
  const hz = navRateHz(values) ?? 1;
  const { outUbx, outNmea } = protocolKeys(port);
  let total = 0;
  for (const m of OUTPUT_MESSAGES) {
    const every = values.get(msgoutKey(m, port)) ?? 0;
    if (every <= 0) continue;
    const protocolOn = values.get(m.protocol === 'UBX' ? outUbx : outNmea) !== 0;
    if (protocolOn) total += (m.bytes * hz) / every;
  }
  return total;
}

const SIGNAL_ENABLES = [
  KEY.SIGNAL_GPS_ENA,
  KEY.SIGNAL_GAL_ENA,
  KEY.SIGNAL_BDS_ENA,
  KEY.SIGNAL_QZSS_ENA,
  KEY.SIGNAL_GLO_ENA,
];

/** M10 limit used for the rate warning; the receiver may accept or reject higher rates. */
const RATE_WARNING_HZ = 10;

export function checkRules(
  values: ConfigValues,
  port: CfgPort,
  baud: number | undefined,
): RuleFinding[] {
  const findings: RuleFinding[] = [];
  const { inUbx, outUbx, outNmea } = protocolKeys(port);

  // Lock-out protection (REQ-CFG-10): the app talks UBX over this port.
  if (values.get(inUbx) === 0) findings.push({ id: 'lockoutUbxIn', severity: 'error' });
  if (values.get(outUbx) === 0) findings.push({ id: 'lockoutUbxOut', severity: 'error' });
  if (values.get(outUbx) === 0 && values.get(outNmea) === 0) {
    findings.push({ id: 'lockoutNoOutput', severity: 'error' });
  }

  const known = SIGNAL_ENABLES.filter((k) => values.has(k));
  if (known.length > 0 && known.every((k) => values.get(k) === 0)) {
    findings.push({ id: 'noConstellation', severity: 'error' });
  }

  const meas = values.get(KEY.RATE_MEAS);
  const hz = navRateHz(values);
  if (meas !== undefined && (meas < 25 || meas > 65535)) {
    findings.push({ id: 'rateInvalid', severity: 'error' });
  } else if (hz !== undefined && hz > RATE_WARNING_HZ) {
    findings.push({
      id: 'rateHigh',
      severity: 'warning',
      params: { hz: Math.round(hz * 10) / 10 },
    });
  }

  // Power-save modes (functional spec §11.4.1).
  const mode = values.get(KEY.PM_OPERATEMODE) ?? PM_MODE.FULL;
  if (mode !== PM_MODE.FULL && hz !== undefined && hz > 1) {
    findings.push({
      id: 'powerSaveRate',
      severity: 'warning',
      params: { hz: Math.round(hz * 10) / 10 },
    });
  }
  if (mode === PM_MODE.PSMOO) findings.push({ id: 'powerSaveSleep', severity: 'warning' });

  if (port === 'UART1' && baud) {
    const capacity = baud / 10;
    const out = estimatedOutputBytesPerSecond(values, port);
    if (out > capacity * 0.8) {
      findings.push({
        id: 'throughput',
        severity: 'warning',
        params: { bytes: Math.round(out), baud },
      });
    }
  }
  return findings;
}
