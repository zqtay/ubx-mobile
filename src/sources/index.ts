import { useSettings } from '@/state/settingsStore';

import type { GnssSource } from './GnssSource';
import { buildDemoLog } from './replay/demoLog';
import { ReplaySource } from './replay/ReplaySource';
import { SourceManager } from './SourceManager';

/** Kinds of source the user can pick in the receiver sheet. */
export type SourceChoice = 'phone' | 'usb' | 'demo';

const settings = useSettings.getState();

/** App-wide source manager. */
export const sourceManager = new SourceManager({
  refreshHz: settings.refreshRateHz,
  satelliteTimeoutMs: settings.satelliteTimeoutS * 1000,
});

useSettings.subscribe((s, prev) => {
  if (s.refreshRateHz !== prev.refreshRateHz) sourceManager.setRefreshRate(s.refreshRateHz);
  if (s.satelliteTimeoutS !== prev.satelliteTimeoutS) {
    sourceManager.setSatelliteTimeout(s.satelliteTimeoutS * 1000);
  }
});

export function createDemoSource(): GnssSource {
  return new ReplaySource(() => buildDemoLog(), { label: 'Demo receiver', loop: true });
}

/** Starts the chosen source and remembers the choice (REQ-SRC-04). */
export async function startSource(choice: SourceChoice): Promise<void> {
  if (choice !== 'demo') throw new Error(`Source "${choice}" is not available yet.`);
  useSettings.getState().update({ lastSource: choice });
  await sourceManager.start(createDemoSource());
}

export async function stopSource(): Promise<void> {
  useSettings.getState().update({ lastSource: undefined });
  await sourceManager.stop();
}

/** Restarts the remembered source on launch, if it can start without user interaction. */
export async function restoreLastSource(): Promise<void> {
  const last = useSettings.getState().lastSource;
  if (last === 'demo') await startSource('demo');
}
