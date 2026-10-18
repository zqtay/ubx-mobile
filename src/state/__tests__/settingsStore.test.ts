import {
  defaultSettings,
  migrateSettings,
  SETTINGS_STORAGE_KEY,
  SETTINGS_VERSION,
  useSettings,
} from '../settingsStore';
import { storage } from '../storage';

describe('migrateSettings', () => {
  it('returns defaults for missing or malformed data', () => {
    expect(migrateSettings(undefined, 0)).toEqual(defaultSettings);
    expect(migrateSettings('garbage', 0)).toEqual(defaultSettings);
    expect(migrateSettings(null, 0)).toEqual(defaultSettings);
  });

  it('keeps known values, fills new keys with defaults and drops unknown keys', () => {
    const migrated = migrateSettings(
      { theme: 'dark', obsoleteKey: 42, usb: { probeUbx: false, legacy: true } },
      0,
    );
    expect(migrated.theme).toBe('dark');
    expect(migrated.usb.probeUbx).toBe(false);
    expect(migrated.usb.ubxMode).toBe(defaultSettings.usb.ubxMode);
    expect(migrated.refreshRateHz).toBe(defaultSettings.refreshRateHz);
    expect(migrated).not.toHaveProperty('obsoleteKey');
    expect(migrated.usb).not.toHaveProperty('legacy');
  });
});

describe('useSettings', () => {
  beforeEach(() => {
    useSettings.getState().reset();
  });

  it('starts with defaults: receiver-safe USB polling and system theme', () => {
    const s = useSettings.getState();
    expect(s.theme).toBe('system');
    expect(s.usb.ubxMode).toBe('poll');
    expect(s.usb.probeUbx).toBe(true);
  });

  it('persists updates to MMKV with the schema version', () => {
    useSettings.getState().update({ theme: 'dark' });
    useSettings.getState().updateUsb({ defaultBaud: 38400 });

    const raw = storage.getString(SETTINGS_STORAGE_KEY);
    expect(raw).toBeDefined();
    const persisted = JSON.parse(raw!);
    expect(persisted.version).toBe(SETTINGS_VERSION);
    expect(persisted.state.theme).toBe('dark');
    expect(persisted.state.usb.defaultBaud).toBe(38400);
    expect(persisted.state.usb.probeUbx).toBe(true);
    // Actions are not persisted.
    expect(persisted.state).not.toHaveProperty('update');
  });

  it('rehydrates persisted settings', async () => {
    storage.set(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({ version: SETTINGS_VERSION, state: { theme: 'light', skyLabels: false } }),
    );
    await useSettings.persist.rehydrate();
    const s = useSettings.getState();
    expect(s.theme).toBe('light');
    expect(s.skyLabels).toBe(false);
    expect(s.usb).toEqual(defaultSettings.usb);
  });
});
