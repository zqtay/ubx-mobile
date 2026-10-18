import { createMMKV, type MMKV } from 'react-native-mmkv';
import type { StateStorage } from 'zustand/middleware';

/** App-wide key-value store. MMKV substitutes an in-memory mock under Jest. */
export const storage: MMKV = createMMKV({ id: 'ubx-mobile' });

/** Adapter so zustand's `persist` middleware can use MMKV synchronously. */
export const zustandStorage: StateStorage = {
  getItem: (name) => storage.getString(name) ?? null,
  setItem: (name, value) => storage.set(name, value),
  removeItem: (name) => {
    storage.remove(name);
  },
};
