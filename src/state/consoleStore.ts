import { create } from 'zustand';

import type { ConsoleEntry } from '@/domain/events';

export type ConsoleKind = ConsoleEntry['kind'];

export interface StoredConsoleEntry extends ConsoleEntry {
  /** Unique, increasing. */
  id: number;
  /** Wall-clock time of arrival. */
  atMs: number;
}

/** Ring buffer size (functional spec §8). */
export const MAX_CONSOLE_ENTRIES = 2000;
/** The visible list is refreshed at most this often, whatever the message rate. */
export const CONSOLE_REFRESH_MS = 250;

interface ConsoleState {
  /** Snapshot shown in the UI (frozen while paused). */
  entries: StoredConsoleEntry[];
  /** Every message name seen, for the filter. */
  names: string[];
  paused: boolean;
  /** Entries received since pausing. */
  missed: number;
  setPaused: (paused: boolean) => void;
  clear: () => void;
}

let buffer: StoredConsoleEntry[] = [];
let nextId = 1;
let missed = 0;
let flushTimer: ReturnType<typeof setTimeout> | undefined;
const names = new Set<string>();
let namesChanged = false;

/** Console entries of the active source (REQ-LOG-01). Fed by `recordConsole`. */
export const useConsole = create<ConsoleState>((set) => ({
  entries: [],
  names: [],
  paused: false,
  missed: 0,
  setPaused: (paused) => {
    set({ paused });
    if (!paused) flush();
  },
  clear: () => {
    buffer = [];
    missed = 0;
    set({ entries: [], missed: 0 });
  },
}));

function flush(): void {
  flushTimer = undefined;
  const state = useConsole.getState();
  if (state.paused) {
    useConsole.setState({ missed });
    return;
  }
  missed = 0;
  useConsole.setState({
    entries: buffer.slice(-MAX_CONSOLE_ENTRIES),
    missed: 0,
    ...(namesChanged ? { names: [...names].sort() } : {}),
  });
  namesChanged = false;
}

/** Adds entries to the ring buffer; the UI picks them up within CONSOLE_REFRESH_MS. */
export function recordConsole(entries: readonly ConsoleEntry[], atMs = Date.now()): void {
  for (const e of entries) {
    buffer.push({ ...e, id: nextId++, atMs });
    if (!names.has(e.name)) {
      names.add(e.name);
      namesChanged = true;
    }
  }
  missed += entries.length;
  // Trim in batches so the buffer is not copied on every frame.
  if (buffer.length > MAX_CONSOLE_ENTRIES * 1.25) buffer = buffer.slice(-MAX_CONSOLE_ENTRIES);
  flushTimer ??= setTimeout(flush, CONSOLE_REFRESH_MS);
}

/** Entries to show for a filter: empty sets mean "all". */
export function filterConsole(
  entries: readonly StoredConsoleEntry[],
  kinds: ReadonlySet<ConsoleKind>,
  selectedNames: ReadonlySet<string>,
): StoredConsoleEntry[] {
  if (kinds.size === 0 && selectedNames.size === 0) return [...entries];
  return entries.filter(
    (e) =>
      (kinds.size === 0 || kinds.has(e.kind)) &&
      (selectedNames.size === 0 || selectedNames.has(e.name)),
  );
}

/** Test helper: forgets everything, including seen names. */
export function resetConsole(): void {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = undefined;
  buffer = [];
  missed = 0;
  names.clear();
  namesChanged = false;
  useConsole.setState({ entries: [], names: [], paused: false, missed: 0 });
}
