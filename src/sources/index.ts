import type { SourceErrorCode } from '@/domain/types';
import { useSettings } from '@/state/settingsStore';

import AndroidGnss from '../../modules/android-gnss';
import { AndroidLocationSource } from './android/AndroidLocationSource';
import { expoLocationPermissions } from './android/permissions';
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

function createSource(choice: SourceChoice): GnssSource {
  switch (choice) {
    case 'demo':
      return createDemoSource();
    case 'phone':
      return new AndroidLocationSource();
    case 'usb':
      throw new Error('USB receivers are not available yet.');
  }
}

/** Starts the chosen source and remembers the choice (REQ-SRC-04). */
export async function startSource(choice: SourceChoice): Promise<void> {
  const source = createSource(choice);
  useSettings.getState().update({ lastSource: choice });
  await sourceManager.start(source);
}

export async function stopSource(): Promise<void> {
  useSettings.getState().update({ lastSource: undefined });
  await sourceManager.stop();
}

/**
 * Restarts the remembered source on launch, only if it can start without prompting the user:
 * the phone source needs location permission to be granted already.
 */
export async function restoreLastSource(): Promise<void> {
  const last = useSettings.getState().lastSource;
  if (last === 'demo') await startSource('demo');
  if (last === 'phone' && (await expoLocationPermissions.check()) === 'granted') {
    await startSource('phone');
  }
}

/** Whether the system permission dialog will be shown for the phone source (so the UI explains it first). */
export async function phoneNeedsPermissionPrompt(): Promise<boolean> {
  const state = await expoLocationPermissions.check();
  return state === 'denied' || state === 'approximate';
}

export type ErrorActionKind = 'allowLocation' | 'turnOnLocation' | 'retry';

/** Which action an error banner offers (functional spec §10). */
export function errorActionKind(code: SourceErrorCode): ErrorActionKind {
  if (code === 'E_PERMISSION') return 'allowLocation';
  if (code === 'E_PROVIDER_DISABLED') return 'turnOnLocation';
  return 'retry';
}

/**
 * Runs the error banner action. Returns false when the UI should instead open the receiver
 * sheet (generic retry).
 */
export async function runErrorAction(code: SourceErrorCode): Promise<boolean> {
  switch (errorActionKind(code)) {
    case 'allowLocation': {
      const state = await expoLocationPermissions.check();
      if (state === 'blocked' || state === 'approximate') {
        AndroidGnss?.openAppSettings();
      } else {
        await startSource('phone');
      }
      return true;
    }
    case 'turnOnLocation':
      // The phone source resumes by itself when location is turned back on.
      AndroidGnss?.openLocationSettings();
      return true;
    default:
      return false;
  }
}
