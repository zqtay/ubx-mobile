import { Alert } from 'react-native';

import { ConfigService } from '@/config/ConfigService';
import i18n from '@/i18n';
import type { SourceErrorCode } from '@/domain/types';
import { createConfigStore } from '@/state/configStore';
import { useGnssStore } from '@/state/gnssStore';
import { usbDeviceKey, useSettings } from '@/state/settingsStore';
import { startSkyTrailRecorder } from '@/state/skyTrailStore';
import { startTrackRecorder } from '@/state/trackStore';

import AndroidGnss from '../../modules/android-gnss';
import UsbSerial, { type UsbSerialDevice } from '../../modules/usb-serial';
import { AndroidLocationSource } from './android/AndroidLocationSource';
import { expoLocationPermissions } from './android/permissions';
import type { GnssSource } from './GnssSource';
import { buildDemoLog } from './replay/demoLog';
import { ReplaySource } from './replay/ReplaySource';
import { SourceManager } from './SourceManager';
import type { FlightControllerInfo } from './usb/flightController';
import { matchesRef, refOf, UsbSerialSource } from './usb/UsbSerialSource';

/** Kinds of source the user can pick in the receiver sheet. */
export type SourceChoice = 'phone' | 'usb' | 'demo';

const settings = useSettings.getState();

/** App-wide source manager. */
export const sourceManager = new SourceManager({
  refreshHz: settings.refreshRateHz,
  satelliteTimeoutMs: settings.satelliteTimeoutS * 1000,
});

// The session track is recorded whichever screen is open (REQ-MAP-07).
startTrackRecorder();
startSkyTrailRecorder();

useSettings.subscribe((s, prev) => {
  if (s.refreshRateHz !== prev.refreshRateHz) sourceManager.setRefreshRate(s.refreshRateHz);
  if (s.satelliteTimeoutS !== prev.satelliteTimeoutS) {
    sourceManager.setSatelliteTimeout(s.satelliteTimeoutS * 1000);
  }
});

const configServices = new WeakMap<GnssSource, ConfigService>();

/**
 * Configuration service for the connected u-blox receiver (technical spec §13), or undefined
 * when the active source is not a USB u-blox receiver. One service per source, so the automatic
 * backup is taken once per connection.
 */
export function getConfigService(): ConfigService | undefined {
  const source = sourceManager.current;
  if (!(source instanceof UsbSerialSource)) return undefined;
  const existing = configServices.get(source);
  if (existing) return existing;
  const link = source.configLink();
  if (!link) return undefined;
  const r = useGnssStore.getState().device.receiver;
  const service = new ConfigService(link, {
    module: r.module,
    fwVersion: r.fwVersion,
    protocolVersion: r.protocolVersion,
    uniqueId: r.uniqueId,
  });
  configServices.set(source, service);
  return service;
}

/** Receiver configuration state for the configuration screens. */
export const useConfigStore = createConfigStore(getConfigService);

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
      throw new Error('Choose a USB device: use startUsbSource().');
  }
}

/** Starts the chosen source and remembers the choice (REQ-SRC-04). */
export async function startSource(choice: SourceChoice): Promise<void> {
  const source = createSource(choice);
  useSettings.getState().update({ lastSource: choice });
  useConfigStore.getState().reset();
  await sourceManager.start(source);
}

/**
 * Asks before enabling GPS passthrough on a flight controller, every time (REQ-SER-16;
 * functional spec §2.2). Resolves false when cancelled or dismissed.
 */
export function confirmPassthrough(fc: FlightControllerInfo): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      i18n.t('fc.title', { name: fc.name }),
      i18n.t('fc.message'),
      [
        { text: i18n.t('common.cancel'), style: 'cancel', onPress: () => resolve(false) },
        { text: i18n.t('fc.enable'), onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

/** Starts the USB source on a device and remembers it (REQ-SER-01..14, REQ-SRC-04). */
export async function startUsbSource(device: UsbSerialDevice): Promise<void> {
  const { usb, usbBauds, update } = useSettings.getState();
  const source = new UsbSerialSource({
    device,
    baud: usb.defaultBaud,
    probeUbx: usb.probeUbx,
    periodicOutput: usb.probeUbx && usb.ubxMode === 'periodic-ram',
    setDtrRts: usb.setDtrRts,
    confirmPassthrough,
    rememberedBaud: usbBauds[usbDeviceKey(refOf(device))],
    onBaudDetected: (ref, baud) => {
      const state = useSettings.getState();
      state.update({
        usbBauds: { ...state.usbBauds, [usbDeviceKey(ref)]: baud },
        lastUsbDevice: ref,
      });
    },
  });
  update({ lastSource: 'usb', lastUsbDevice: refOf(device) });
  useConfigStore.getState().reset();
  await sourceManager.start(source);
}

export type UsbAvailability = 'ok' | 'unsupported' | 'unavailable';

/** Whether USB receivers can be used on this phone/build (functional spec §10). */
export function usbAvailability(): UsbAvailability {
  if (!UsbSerial) return 'unavailable';
  return UsbSerial.isUsbHostSupported() ? 'ok' : 'unsupported';
}

export async function listUsbDevices(): Promise<UsbSerialDevice[]> {
  return UsbSerial ? UsbSerial.listDevices() : [];
}

/** Subscribes to USB attach/detach to keep device lists current. Returns an unsubscribe function. */
export function watchUsbDevices(onChange: () => void): () => void {
  if (!UsbSerial) return () => undefined;
  const subs = [
    UsbSerial.addListener('onAttached', onChange),
    UsbSerial.addListener('onDetached', onChange),
  ];
  return () => subs.forEach((s) => s.remove());
}

export async function stopSource(): Promise<void> {
  useSettings.getState().update({ lastSource: undefined });
  useConfigStore.getState().reset();
  await sourceManager.stop();
}

/**
 * Restarts the remembered source on launch, only if it can start without prompting the user:
 * the phone source needs location permission to be granted already.
 */
export async function restoreLastSource(): Promise<void> {
  // Opened by plugging in a receiver (USB_DEVICE_ATTACHED intent): use that device (REQ-SER-13).
  const launchDevice = UsbSerial ? await UsbSerial.getLaunchDevice().catch(() => null) : null;
  if (launchDevice) return startUsbSource(launchDevice);

  const { lastSource: last, lastUsbDevice } = useSettings.getState();
  if (last === 'usb' && lastUsbDevice) {
    const device = (await listUsbDevices()).find(
      (d) => d.hasPermission && matchesRef(d, lastUsbDevice),
    );
    if (device) await startUsbSource(device);
    return;
  }
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
