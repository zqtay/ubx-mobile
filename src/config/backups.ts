import { storage } from '@/state/storage';

import { keyName } from './keys';
import type { CfgItem } from './valCodec';

export interface BackupEntry {
  id: string;
  name: string;
  value: number;
}

/** Backup file format (technical spec §13.5). */
export interface ConfigBackup {
  format: 'ubx-mobile-config';
  version: 1;
  createdAt: string;
  /** 'auto' = taken before the first change of a session; 'imported' = pasted by the user. */
  kind: 'auto' | 'manual' | 'imported';
  receiver: { module?: string; fwVersion?: string; protocolVersion?: string; uniqueId?: string };
  /** `ram` is always present; the other layers in full backups. */
  layers: {
    ram: BackupEntry[];
    bbr?: BackupEntry[];
    flash?: BackupEntry[];
    default?: BackupEntry[];
  };
}

export interface BackupLayers {
  ram: readonly CfgItem[];
  bbr?: readonly CfgItem[];
  flash?: readonly CfgItem[];
  default?: readonly CfgItem[];
}

const STORAGE_KEY = 'configBackups';
const MAX_BACKUPS = 20;

const hexId = (key: number) => `0x${key.toString(16).toUpperCase().padStart(8, '0')}`;
const entries = (items: readonly CfgItem[]) =>
  items.map((it) => ({ id: hexId(it.key), name: keyName(it.key), value: it.value }));

export function createBackup(
  kind: ConfigBackup['kind'],
  receiver: ConfigBackup['receiver'],
  layers: BackupLayers,
  atMs = Date.now(),
): ConfigBackup {
  return {
    format: 'ubx-mobile-config',
    version: 1,
    createdAt: new Date(atMs).toISOString(),
    kind,
    receiver,
    layers: {
      ram: entries(layers.ram),
      ...(layers.bbr ? { bbr: entries(layers.bbr) } : {}),
      ...(layers.flash ? { flash: entries(layers.flash) } : {}),
      ...(layers.default ? { default: entries(layers.default) } : {}),
    },
  };
}

/** Identifies a stored backup (route parameter). */
export function backupId(b: ConfigBackup): string {
  return `${b.kind}-${b.createdAt}`;
}

export function listBackups(): ConfigBackup[] {
  try {
    const raw = storage.getString(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as ConfigBackup[]) : [];
  } catch {
    return [];
  }
}

/** Keeps the newest 20 backups. */
export function storeBackup(backup: ConfigBackup): void {
  const all = [...listBackups().filter((b) => backupId(b) !== backupId(backup)), backup].slice(
    -MAX_BACKUPS,
  );
  storage.set(STORAGE_KEY, JSON.stringify(all));
}

export function findBackup(id: string): ConfigBackup | undefined {
  return listBackups().find((b) => backupId(b) === id);
}

export type BackupLayer = keyof ConfigBackup['layers'];

/** Items of one layer of a backup, for restoring. */
export function backupItems(backup: ConfigBackup, layer: BackupLayer = 'ram'): CfgItem[] {
  return (backup.layers[layer] ?? []).map((e) => ({ key: parseInt(e.id, 16), value: e.value }));
}

/**
 * Values the receiver starts with according to a backup (BBR over Flash), or undefined when the
 * backup holds no stored layer.
 */
export function savedItems(backup: ConfigBackup): CfgItem[] | undefined {
  if (!backup.layers.bbr && !backup.layers.flash) return undefined;
  const merged = new Map<number, number>();
  for (const it of backupItems(backup, 'flash')) merged.set(it.key, it.value);
  for (const it of backupItems(backup, 'bbr')) merged.set(it.key, it.value);
  return [...merged].map(([key, value]) => ({ key, value }));
}

export class BackupFormatError extends Error {}

const validEntries = (list: unknown): list is BackupEntry[] =>
  Array.isArray(list) &&
  list.every(
    (e) =>
      e && typeof e.id === 'string' && /^0x[0-9a-f]{8}$/i.test(e.id) && typeof e.value === 'number',
  );

/** Parses pasted/shared backup JSON. Throws BackupFormatError when it is not a UBX Mobile backup. */
export function parseBackup(text: string): ConfigBackup {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new BackupFormatError('Not JSON');
  }
  const b = data as Partial<ConfigBackup> | null;
  const layers = b?.layers;
  if (
    b?.format !== 'ubx-mobile-config' ||
    b.version !== 1 ||
    !layers ||
    !validEntries(layers.ram) ||
    (['bbr', 'flash', 'default'] as const).some(
      (l) => layers[l] !== undefined && !validEntries(layers[l]),
    )
  ) {
    throw new BackupFormatError('Not a UBX Mobile configuration backup');
  }
  return {
    format: 'ubx-mobile-config',
    version: 1,
    createdAt: typeof b.createdAt === 'string' ? b.createdAt : new Date().toISOString(),
    kind: 'imported',
    receiver: b.receiver ?? {},
    layers,
  };
}

export interface RestorePlan {
  /** Values that differ from the receiver's current values. */
  changes: { key: number; from: number; to: number }[];
  /** Keys whose current value already matches. */
  unchanged: number;
  /** Keys the receiver does not report (skipped). */
  unknown: number[];
}

/** Differences between backup items and the receiver's current (RAM) values. */
export function restorePlan(
  items: readonly CfgItem[],
  current: ReadonlyMap<number, number>,
): RestorePlan {
  const plan: RestorePlan = { changes: [], unchanged: 0, unknown: [] };
  for (const { key, value } of items) {
    const now = current.get(key);
    if (now === undefined) plan.unknown.push(key);
    else if (now === value) plan.unchanged += 1;
    else plan.changes.push({ key, from: now, to: value });
  }
  return plan;
}

/** Whether a backup comes from a different receiver model or firmware (restore warning). */
export function differentReceiver(
  backup: ConfigBackup,
  receiver: ConfigBackup['receiver'],
): boolean {
  const differs = (a?: string, b?: string) => a !== undefined && b !== undefined && a !== b;
  return (
    differs(backup.receiver.module, receiver.module) ||
    differs(backup.receiver.fwVersion, receiver.fwVersion) ||
    differs(backup.receiver.protocolVersion, receiver.protocolVersion)
  );
}
