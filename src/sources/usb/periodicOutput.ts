import { KEY, msgoutKey, OUTPUT_MESSAGES, type CfgPort } from '@/config/keys';
import {
  buildValGetPayload,
  buildValSetFrames,
  LAYER,
  LAYER_MASK,
  parseValGetResponse,
} from '@/config/valCodec';
import { logDiagnostic } from '@/state/diagnostics';

import { ConfigWriteRequest, type UbxClient } from './UbxClient';

/** Messages the app would otherwise poll, with their target output rate in Hz. */
const PERIODIC: { label: string; hz: number }[] = [
  { label: 'NAV-PVT', hz: 5 },
  { label: 'NAV-SAT', hz: 1 },
  { label: 'NAV-SIG', hz: 1 },
  { label: 'NAV-DOP', hz: 1 },
  { label: 'NAV-STATUS', hz: 1 },
];

export type PeriodicOutputResult = 'enabled' | 'already' | 'unsupported' | 'failed';

/**
 * Opt-in periodic UBX output (REQ-SER-09, Settings → USB → UBX data mode): enables the
 * messages the app polls on the connected port, in RAM only, so a power cycle restores the
 * receiver. Messages the receiver already outputs are left alone. Rates are chosen from the
 * measurement rate so the link is not flooded (≤ 5 Hz NAV-PVT, ≈ 1 Hz for the rest).
 */
export async function enablePeriodicOutput(
  client: UbxClient,
  port: CfgPort,
): Promise<PeriodicOutputResult> {
  const messages = PERIODIC.map((p) => ({
    ...p,
    key: msgoutKey(
      OUTPUT_MESSAGES.find((m) => m.label === p.label)!,
      port,
    ),
  }));
  const response = await client.valget(
    buildValGetPayload(LAYER.RAM, [KEY.RATE_MEAS, KEY.RATE_NAV, ...messages.map((m) => m.key)]),
  );
  if (response === 'nak') return 'unsupported';
  if (response === 'timeout') return 'failed';
  const values = new Map(parseValGetResponse(response)?.items.map((i) => [i.key, i.value]));
  const meas = values.get(KEY.RATE_MEAS) ?? 1000;
  const navHz = 1000 / meas / (values.get(KEY.RATE_NAV) || 1);
  const items = messages
    .filter((m) => values.has(m.key) && values.get(m.key) === 0)
    .map((m) => ({ key: m.key, value: Math.min(255, Math.max(1, Math.round(navHz / m.hz))) }));
  if (items.length === 0) return 'already';

  const result = await client.configure(
    new ConfigWriteRequest(
      'periodic-output',
      buildValSetFrames(LAYER_MASK.RAM, items),
      `periodic UBX output (RAM): ${items.length} messages`,
    ),
  );
  logDiagnostic({
    level: result.ok ? 'info' : 'warning',
    area: 'usb',
    message: `Periodic UBX output: ${result.ok ? 'enabled (RAM)' : result.outcomes.join(', ')}`,
  });
  return result.ok ? 'enabled' : 'failed';
}
