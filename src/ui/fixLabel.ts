import type { Fix, GnssSnapshot } from '@/domain/types';
import type { Palette } from '@/ui/theme/tokens';

/** Fix banner classification (functional spec §3.2). Always shown with a text label. */
export type FixLabelKey =
  'none' | 'timeOnly' | 'dr' | '2d' | '3d' | 'gnssDr' | 'dgnss' | 'rtkFloat' | 'rtkFixed';

export type FixTone = keyof Palette['fix'];

export function fixLabelKey(fix: Fix | undefined): FixLabelKey {
  if (!fix) return 'none';
  switch (fix.fixType) {
    case 'none':
      return 'none';
    case 'time-only':
      return 'timeOnly';
    case 'dead-reckoning':
      return 'dr';
    case '2d':
      return '2d';
    case 'gnss-dr':
      return 'gnssDr';
    case '3d':
      if (fix.carrierSolution === 'fixed') return 'rtkFixed';
      if (fix.carrierSolution === 'float') return 'rtkFloat';
      if (fix.differential) return 'dgnss';
      return '3d';
  }
}

export function fixTone(key: FixLabelKey): FixTone {
  switch (key) {
    case 'none':
      return 'none';
    case 'timeOnly':
    case 'dr':
    case '2d':
      return 'weak';
    case 'rtkFloat':
    case 'rtkFixed':
      return 'rtk';
    default:
      return 'good';
  }
}

export type ChipStateKey =
  'none' | 'connecting' | 'detecting' | 'waiting' | 'disconnected' | 'error' | 'fix';

export interface ChipState {
  /** What the chip's state text describes; `fix` uses `fixKey`. */
  key: ChipStateKey;
  fixKey?: FixLabelKey;
  tone: 'idle' | 'ok' | 'warn' | 'error';
}

/** Header status chip state (REQ-SRC-03). */
export function chipState(
  snapshot: Pick<GnssSnapshot, 'source' | 'connection' | 'fix'>,
): ChipState {
  const { source, connection, fix } = snapshot;
  if (!source) return { key: 'none', tone: 'idle' };
  switch (connection.kind) {
    case 'idle':
    case 'connecting':
      return { key: 'connecting', tone: 'idle' };
    case 'detecting':
      return { key: 'detecting', tone: 'idle' };
    case 'waiting':
      return { key: 'waiting', tone: 'warn' };
    case 'disconnected':
      return { key: 'disconnected', tone: 'warn' };
    case 'error':
      return { key: 'error', tone: 'error' };
    case 'receiving': {
      const fixKey = fixLabelKey(fix);
      return { key: 'fix', fixKey, tone: fixKey === 'none' ? 'warn' : 'ok' };
    }
  }
}
