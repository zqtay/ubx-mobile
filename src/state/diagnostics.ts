import { create } from 'zustand';

export type LogLevel = 'info' | 'warning' | 'error';

export interface LogEntry {
  atMs: number;
  level: LogLevel;
  /** e.g. 'config', 'usb'. */
  area: string;
  message: string;
  details?: string;
}

const MAX_ENTRIES = 500;

interface DiagnosticsState {
  entries: LogEntry[];
  add: (entry: Omit<LogEntry, 'atMs'> & { atMs?: number }) => void;
  clear: () => void;
}

/** In-app diagnostics log (REQ-LOG-03): a ring buffer the user can share from About. */
export const useDiagnostics = create<DiagnosticsState>((set) => ({
  entries: [],
  add: (entry) =>
    set((s) => ({
      entries: [...s.entries, { atMs: Date.now(), ...entry }].slice(-MAX_ENTRIES),
    })),
  clear: () => set({ entries: [] }),
}));

export function logDiagnostic(entry: Omit<LogEntry, 'atMs'>): void {
  useDiagnostics.getState().add(entry);
}

/** Plain-text report of the log for sharing (oldest first). */
export function diagnosticsReport(entries: readonly LogEntry[], header: string): string {
  const lines = entries.map((e) => {
    const time = new Date(e.atMs).toISOString();
    const details = e.details ? `\n    ${e.details}` : '';
    return `${time} ${e.level.toUpperCase().padEnd(7)} [${e.area}] ${e.message}${details}`;
  });
  return [header, '', ...lines].join('\n');
}
