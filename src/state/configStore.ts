import { create } from 'zustand';

import {
  ConfigTimeoutError,
  type ApplyResult,
  type ApplyStatus,
  type ConfigService,
  type LayerValues,
  type Mismatch,
} from '@/config/ConfigService';
import type { CfgPort } from '@/config/keys';
import { checkRules, type RuleFinding } from '@/config/rules';
import { allSectionKeys } from '@/config/sections';
import type { RestartKind } from '@/config/valCodec';
import type { ConfigAction } from '@/sources/usb/UbxClient';

export type ConfigBusy = ConfigAction | 'load';

export interface ConfigOutcome {
  action: ConfigAction;
  status: ApplyStatus | 'done' | 'failed';
  mismatches: Mismatch[];
}

export interface ConfigState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  /** Set when status is 'error'. */
  error?: 'timeout' | 'unavailable' | 'failed';
  port?: CfgPort;
  /** Phone-side baud rate when connected through a UART bridge. */
  baud?: number;
  ram: LayerValues;
  bbr: LayerValues;
  flash: LayerValues;
  def: LayerValues;
  hasFlash: boolean;
  /** Changes made in the app, not yet applied to the receiver (functional spec §11.5). */
  staged: Map<number, number>;
  busy?: ConfigBusy;
  lastOutcome?: ConfigOutcome;

  load(): Promise<void>;
  stage(key: number, value: number): void;
  unstage(key: number): void;
  discard(): void;
  apply(): Promise<ApplyResult | undefined>;
  save(): Promise<ApplyResult | undefined>;
  revertToSaved(): Promise<ApplyResult | undefined>;
  restart(kind: RestartKind): Promise<void>;
  factoryReset(): Promise<boolean>;
  /** Forgets everything (source changed). */
  reset(): void;
}

type Data = Pick<ConfigState, 'ram' | 'bbr' | 'flash' | 'def' | 'staged'>;

/** Current values with staged changes on top: what the receiver will run after Apply. */
export function effectiveValues(s: Pick<Data, 'ram' | 'staged'>): Map<number, number> {
  return new Map([...s.ram, ...s.staged]);
}

/** Value the receiver loads at start-up: BBR, else Flash, else the default. */
export function storedValue(
  s: Pick<Data, 'bbr' | 'flash' | 'def'>,
  key: number,
): number | undefined {
  return s.bbr.get(key) ?? s.flash.get(key) ?? s.def.get(key);
}

/** Keys whose current value is lost at power-off (applied but not saved, REQ-CFG-05). */
export function unsavedKeys(s: Omit<Data, 'staged'>): number[] {
  return [...s.ram]
    .filter(([key, value]) => {
      const stored = storedValue(s, key);
      return stored !== undefined && stored !== value;
    })
    .map(([key]) => key);
}

export function findings(s: Pick<ConfigState, 'ram' | 'staged' | 'port' | 'baud'>): RuleFinding[] {
  if (!s.port) return [];
  return checkRules(effectiveValues(s), s.port, s.baud);
}

const empty = () => ({
  ram: new Map<number, number>(),
  bbr: new Map<number, number>(),
  flash: new Map<number, number>(),
  def: new Map<number, number>(),
  hasFlash: false,
  staged: new Map<number, number>(),
});

/**
 * Receiver configuration state (technical spec §13.3). `getService` returns the service for the
 * connected receiver, or undefined when configuration is unavailable.
 */
export function createConfigStore(getService: () => ConfigService | undefined) {
  return create<ConfigState>((set, get) => {
    /** Runs an action exclusively; returns undefined when busy or unavailable. */
    const run = async <T>(
      busy: ConfigBusy,
      fn: (service: ConfigService) => Promise<T>,
    ): Promise<T | undefined> => {
      if (get().busy) return undefined;
      const service = getService();
      if (!service) {
        set({ status: 'error', error: 'unavailable' });
        return undefined;
      }
      set({ busy });
      try {
        return await fn(service);
      } finally {
        set({ busy: undefined });
      }
    };

    const reload = async (service: ConfigService) => {
      const loaded = await service.load(allSectionKeys(service.port));
      set({
        ...loaded,
        port: service.port,
        baud: service.localBaud,
        status: 'ready',
        error: undefined,
      });
    };

    const outcome = (action: ConfigAction, result: ApplyResult) =>
      set({ lastOutcome: { action, status: result.status, mismatches: result.mismatches } });

    /** Applies items and reloads; keeps staged changes when nothing was applied. */
    const write = async (
      action: ConfigAction,
      fn: (service: ConfigService) => Promise<ApplyResult>,
    ) =>
      run(action, async (service) => {
        try {
          const result = await fn(service);
          outcome(action, result);
          if (result.status === 'lost') {
            set({ status: 'error', error: 'failed' });
            return result;
          }
          if (result.status === 'applied' || result.status === 'mismatch')
            set({ staged: new Map() });
          await reload(service).catch(() => undefined);
          return result;
        } catch {
          set({ lastOutcome: { action, status: 'failed', mismatches: [] } });
          return undefined;
        }
      });

    return {
      status: 'idle',
      ...empty(),

      load: async () => {
        await run('load', async (service) => {
          set({ status: 'loading', error: undefined });
          try {
            await reload(service);
          } catch (e) {
            set({ status: 'error', error: e instanceof ConfigTimeoutError ? 'timeout' : 'failed' });
          }
        });
      },

      stage: (key, value) => {
        const staged = new Map(get().staged);
        if (get().ram.get(key) === value) staged.delete(key);
        else staged.set(key, value);
        set({ staged });
      },

      unstage: (key) => {
        const staged = new Map(get().staged);
        staged.delete(key);
        set({ staged });
      },

      discard: () => set({ staged: new Map() }),

      apply: async () => {
        const changes = [...get().staged].map(([key, value]) => ({ key, value }));
        if (changes.length === 0) return undefined;
        if (findings(get()).some((f) => f.severity === 'error')) return undefined;
        return write('apply', (service) => service.apply(changes));
      },

      save: async () => {
        const keys = unsavedKeys(get());
        if (keys.length === 0) return undefined;
        return write('save', (service) => service.save(keys, get().hasFlash));
      },

      revertToSaved: async () => {
        const s = get();
        const items = unsavedKeys(s).map((key) => ({ key, value: storedValue(s, key)! }));
        if (items.length === 0) return undefined;
        return write('revert', (service) => service.revert(items));
      },

      restart: async (kind) => {
        await run('restart', async (service) => {
          try {
            await service.restart(kind);
            set({ lastOutcome: { action: 'restart', status: 'done', mismatches: [] } });
          } catch {
            set({ lastOutcome: { action: 'restart', status: 'failed', mismatches: [] } });
          }
        });
      },

      factoryReset: async () => {
        const ok = await run('factory-reset', async (service) => {
          try {
            const done = await service.factoryReset([...get().ram.keys()]);
            set({
              staged: new Map(),
              lastOutcome: {
                action: 'factory-reset',
                status: done ? 'done' : 'failed',
                mismatches: [],
              },
            });
            if (done) await reload(service).catch(() => set({ status: 'idle' }));
            return done;
          } catch {
            set({ lastOutcome: { action: 'factory-reset', status: 'failed', mismatches: [] } });
            return false;
          }
        });
        return ok ?? false;
      },

      reset: () =>
        set({
          status: 'idle',
          error: undefined,
          port: undefined,
          baud: undefined,
          lastOutcome: undefined,
          ...empty(),
        }),
    };
  });
}

export type ConfigStore = ReturnType<typeof createConfigStore>;
