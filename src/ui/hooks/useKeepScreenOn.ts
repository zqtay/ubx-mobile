import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useEffect } from 'react';

import { useGnssStore } from '@/state/gnssStore';
import { useSettings } from '@/state/settingsStore';

const TAG = 'ubx-mobile-receiver';

/** Keeps the screen on while a receiver is active, if enabled in Settings (REQ-SET-03). */
export function useKeepScreenOn(): void {
  const enabled = useSettings((s) => s.keepScreenOn);
  const active = useGnssStore(
    (s) =>
      s.source !== null &&
      s.connection.kind !== 'idle' &&
      s.connection.kind !== 'error' &&
      s.connection.kind !== 'disconnected',
  );
  useEffect(() => {
    if (!enabled || !active) return;
    activateKeepAwakeAsync(TAG).catch(() => undefined);
    return () => {
      deactivateKeepAwake(TAG).catch(() => undefined);
    };
  }, [enabled, active]);
}
