import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { zustandStorage } from './storage';

/** Settings catalogue (functional spec §9). */
export type ThemePreference = 'system' | 'light' | 'dark';
export type SvLabelStyle = 'ucenter' | 'rinex';
export type CoordinateFormat = 'dd' | 'dms' | 'ddm';
export type UnitSystem = 'metric' | 'imperial';
export type RefreshRateHz = 1 | 2 | 5;
export type SatelliteTimeoutS = 3 | 5 | 10 | 30;
export type SkyTrails = 'off' | '10m' | '1h';
export type UbxDataMode = 'poll' | 'periodic-ram';
export type BaudSetting =
  'auto' | 4800 | 9600 | 19200 | 38400 | 57600 | 115200 | 230400 | 460800 | 921600;

export interface UsbSettings {
  defaultBaud: BaudSetting;
  probeUbx: boolean;
  ubxMode: UbxDataMode;
  setDtrRts: boolean;
}

export interface Settings {
  theme: ThemePreference;
  svLabelStyle: SvLabelStyle;
  showFlags: boolean;
  coordinateFormat: CoordinateFormat;
  units: UnitSystem;
  refreshRateHz: RefreshRateHz;
  satelliteTimeoutS: SatelliteTimeoutS;
  keepScreenOn: boolean;
  skyDenseGrid: boolean;
  skyLabels: boolean;
  skyTrails: SkyTrails;
  usb: UsbSettings;
}

export const defaultSettings: Settings = {
  theme: 'system',
  svLabelStyle: 'ucenter',
  showFlags: false,
  coordinateFormat: 'dd',
  units: 'metric',
  refreshRateHz: 2,
  satelliteTimeoutS: 5,
  keepScreenOn: true,
  skyDenseGrid: false,
  skyLabels: true,
  skyTrails: 'off',
  usb: {
    defaultBaud: 'auto',
    probeUbx: true,
    ubxMode: 'poll',
    setDtrRts: true,
  },
};

export interface SettingsActions {
  update: (patch: Partial<Omit<Settings, 'usb'>>) => void;
  updateUsb: (patch: Partial<UsbSettings>) => void;
  reset: () => void;
}

export type SettingsState = Settings & SettingsActions;

export const SETTINGS_STORAGE_KEY = 'settings';
/** Bump when the persisted shape changes, and handle the old version in `migrateSettings`. */
export const SETTINGS_VERSION = 1;

/**
 * Upgrades persisted settings from any earlier schema version and fills in
 * defaults for keys that did not exist yet. Unknown keys are dropped.
 */
export function migrateSettings(persisted: unknown, _fromVersion: number): Settings {
  const p = (persisted && typeof persisted === 'object' ? persisted : {}) as Partial<Settings>;
  const merged: Settings = {
    ...defaultSettings,
    ...pickKnown(p, defaultSettings),
    usb: { ...defaultSettings.usb, ...pickKnown(p.usb ?? {}, defaultSettings.usb) },
  };
  return merged;
}

function pickKnown<T extends object>(source: Partial<T>, reference: T): Partial<T> {
  const out: Partial<T> = {};
  for (const key of Object.keys(reference) as (keyof T)[]) {
    if (key in source && source[key] !== undefined) out[key] = source[key];
  }
  return out;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      ...defaultSettings,
      update: (patch) => set(patch),
      updateUsb: (patch) => set((s) => ({ usb: { ...s.usb, ...patch } })),
      reset: () => set(defaultSettings),
    }),
    {
      name: SETTINGS_STORAGE_KEY,
      version: SETTINGS_VERSION,
      storage: createJSONStorage(() => zustandStorage),
      partialize: ({ update: _u, updateUsb: _uu, reset: _r, ...settings }) => settings,
      migrate: (persisted, version) => migrateSettings(persisted, version),
      merge: (persisted, current) => ({
        ...current,
        ...migrateSettings(persisted, SETTINGS_VERSION),
      }),
    },
  ),
);
