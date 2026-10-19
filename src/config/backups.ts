import { storage } from '@/state/storage';

import { keyName } from './keys';
import type { CfgItem } from './valCodec';

/** Backup file format (technical spec §13.5). */
export interface ConfigBackup {
  format: 'ubx-mobile-config';
  version: 1;
  createdAt: string;
  /** 'auto' = taken before the first change of a session. */
  kind: 'auto' | 'manual';
  receiver: { module?: string; fwVersion?: string; protocolVersion?: string; uniqueId?: string };
  layers: { ram: { id: string; name: string; value: number }[] };
}

const STORAGE_KEY = 'configBackups';
const MAX_BACKUPS = 20;

const hexId = (key: number) => `0x${key.toString(16).toUpperCase().padStart(8, '0')}`;

export function createBackup(
  kind: ConfigBackup['kind'],
  receiver: ConfigBackup['receiver'],
  ram: readonly CfgItem[],
  atMs = Date.now(),
): ConfigBackup {
  return {
    format: 'ubx-mobile-config',
    version: 1,
    createdAt: new Date(atMs).toISOString(),
    kind,
    receiver,
    layers: {
      ram: ram.map((it) => ({ id: hexId(it.key), name: keyName(it.key), value: it.value })),
    },
  };
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
  const all = [...listBackups(), backup].slice(-MAX_BACKUPS);
  storage.set(STORAGE_KEY, JSON.stringify(all));
}

/** Items of a backup's RAM layer, for restoring. */
export function backupItems(backup: ConfigBackup): CfgItem[] {
  return backup.layers.ram.map((e) => ({ key: parseInt(e.id, 16), value: e.value }));
}
