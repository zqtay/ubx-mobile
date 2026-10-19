import type { GnssEvent } from '@/domain/events';
import { withChecksum } from '@/protocols/nmea/checksum';

import type {
  AndroidGnssEvents,
  AndroidGnssModule,
  NativeDeviceInfo,
  NativeSvStatus,
} from '../../../modules/android-gnss';
import {
  AndroidLocationSource,
  fixFromLocation,
  satellitesFromStatus,
} from '../android/AndroidLocationSource';
import type { LocationPermission, PermissionGateway } from '../android/permissions';
import { errorActionKind } from '../index';

const sv = (patch: Partial<NativeSvStatus>): NativeSvStatus => ({
  constellationType: 1,
  svid: 14,
  cn0DbHz: 30,
  elevationDeg: 45,
  azimuthDeg: 90,
  hasAlmanac: true,
  hasEphemeris: true,
  usedInFix: false,
  ...patch,
});

const DEVICE: NativeDeviceInfo = {
  manufacturer: 'samsung',
  model: 'SM-A536E',
  androidRelease: '14',
  sdkInt: 34,
  fingerprint: 'samsung/a53x/…',
  hasGnssFeature: true,
  gnssHardwareModelName: 'BCM4775 MSG',
  gnssYearOfHardware: 2021,
  capabilities: { measurements: true, navigationMessages: false },
  antennaInfos: null,
};

/** In-memory stand-in for the native module. */
class FakeNative {
  listeners = new Map<string, ((payload: never) => void)[]>();
  provider = { locationEnabled: true, gpsProviderEnabled: true };
  device: NativeDeviceInfo = DEVICE;
  start = jest.fn(async () => {});
  stop = jest.fn(async () => {});
  getDeviceInfo = jest.fn(async () => this.device);
  getProviderState = jest.fn(async () => this.provider);
  hasFineLocationPermission = jest.fn(() => true);
  openLocationSettings = jest.fn();
  openAppSettings = jest.fn();
  addListener<K extends keyof AndroidGnssEvents>(name: K, fn: AndroidGnssEvents[K]) {
    const list = this.listeners.get(name) ?? [];
    list.push(fn as never);
    this.listeners.set(name, list);
    return {
      remove: () =>
        this.listeners.set(
          name,
          (this.listeners.get(name) ?? []).filter((f) => f !== fn),
        ),
    };
  }
  fire<K extends keyof AndroidGnssEvents>(name: K, payload: Parameters<AndroidGnssEvents[K]>[0]) {
    for (const fn of this.listeners.get(name) ?? []) (fn as (p: typeof payload) => void)(payload);
  }
  get listenerCount() {
    return [...this.listeners.values()].reduce((n, l) => n + l.length, 0);
  }
}

function permissions(initial: LocationPermission) {
  const gateway: PermissionGateway & {
    state: LocationPermission;
    check: jest.Mock<Promise<LocationPermission>>;
    request: jest.Mock<Promise<LocationPermission>>;
  } = {
    state: initial,
    check: jest.fn(async () => gateway.state),
    request: jest.fn(async () => gateway.state),
  };
  return gateway;
}

async function setup(
  permission: LocationPermission = 'granted',
  configure?: (n: FakeNative) => void,
) {
  const native = new FakeNative();
  configure?.(native);
  const perms = permissions(permission);
  const events: GnssEvent[] = [];
  const source = new AndroidLocationSource({
    native: native as unknown as AndroidGnssModule,
    permissions: perms,
    now: () => 1000,
  });
  await source.start((e) => events.push(e));
  const last = <T extends GnssEvent['t']>(t: T) =>
    [...events].reverse().find((e): e is Extract<GnssEvent, { t: T }> => e.t === t);
  return { native, perms, events, source, last };
}

describe('satellitesFromStatus (REQ-AND-03, REQ-AND-07)', () => {
  it('merges dual-frequency entries of one satellite into signals', () => {
    const sats = satellitesFromStatus(
      [
        sv({ carrierHz: 1575.42e6, cn0DbHz: 38, usedInFix: true }),
        sv({ carrierHz: 1176.45e6, cn0DbHz: 41.5, usedInFix: false, basebandCn0DbHz: 37 }),
        sv({ constellationType: 6, svid: 4, carrierHz: 1575.42e6 }),
      ],
      500,
    );
    expect(sats).toHaveLength(2);
    expect(sats[0]).toMatchObject({
      key: 'GPS:14',
      cn0: 41.5,
      used: true,
      elevation: 45,
      azimuth: 90,
      basebandCn0: 37,
      signals: [
        { code: 'L1', cn0: 38, used: true, lastSeenMs: 500 },
        { code: 'L5', cn0: 41.5, used: false },
      ],
    });
    expect(sats[1]).toMatchObject({ key: 'GALILEO:4', signals: [{ code: 'E1' }] });
  });

  it('applies the unknown-position rule and Android numbering', () => {
    const sats = satellitesFromStatus(
      [
        sv({
          svid: 2,
          hasAlmanac: false,
          hasEphemeris: false,
          elevationDeg: 0,
          azimuthDeg: 0,
          cn0DbHz: 0,
        }),
        sv({ constellationType: 3, svid: 97 }),
        sv({ constellationType: 4, svid: 193 }),
        sv({ svid: 5, carrierHz: 1600e6 }),
      ],
      0,
    );
    expect(sats[0]).toMatchObject({
      key: 'GPS:2',
      elevation: undefined,
      azimuth: undefined,
      cn0: 0,
    });
    expect(sats[0].signals).toBeUndefined();
    expect(sats[1].key).toBe('GLONASS:fcn-3');
    expect(sats[2].key).toBe('QZSS:193');
    expect(sats[3].signals?.[0]).toMatchObject({ code: '1600 MHz', label: '1600.00 MHz' });
  });

  it('takes the position from a later entry if the first one had none', () => {
    const [sat] = satellitesFromStatus(
      [
        sv({ hasAlmanac: false, hasEphemeris: false, elevationDeg: 0, azimuthDeg: 0 }),
        sv({ elevationDeg: 33.6, azimuthDeg: 200.2 }),
      ],
      0,
    );
    expect(sat).toMatchObject({ elevation: 34, azimuth: 200 });
  });
});

describe('fixFromLocation (REQ-AND-04)', () => {
  it('maps Location fields; altitude is ellipsoidal', () => {
    expect(
      fixFromLocation({
        lat: 1.35,
        lon: 103.8,
        alt: 39.9,
        altMsl: 32.4,
        acc: 3.5,
        vAcc: 5,
        speed: 0.2,
        speedAcc: 0.1,
        bearing: 12,
        bearingAcc: 30,
        timeMs: 1_760_000_000_000,
        elapsedRealtimeNanos: 0,
        isMock: false,
      }),
    ).toEqual({
      fixType: '3d',
      lat: 1.35,
      lon: 103.8,
      altEllipsoidM: 39.9,
      altMslM: 32.4,
      hAccM: 3.5,
      vAccM: 5,
      speedMps: 0.2,
      speedAccMps: 0.1,
      courseDeg: 12,
      courseAccDeg: 30,
      utc: { epochMs: 1_760_000_000_000, dateValid: true, timeValid: true },
      isMock: false,
    });
    expect(
      fixFromLocation({ lat: 1, lon: 2, timeMs: 0, elapsedRealtimeNanos: 0, isMock: true }).fixType,
    ).toBe('2d');
  });
});

describe('AndroidLocationSource', () => {
  it('starts after permission, reports the device and streams data (REQ-AND-01..06)', async () => {
    const { native, events, last } = await setup();
    expect(native.start).toHaveBeenCalledWith({ minTimeMs: 1000, nmea: true, nmeaBatchMs: 200 });
    expect(last('android')?.patch).toMatchObject({
      manufacturer: 'samsung',
      gnssHardwareModelName: 'BCM4775 MSG',
    });
    expect(last('connection')?.state).toEqual({ kind: 'detecting' });

    native.fire('onGnssStatus', {
      sats: [sv({ usedInFix: true }), sv({ svid: 5, cn0DbHz: 0 })],
      atMs: 10,
    });
    expect(last('satellites')).toMatchObject({ origin: 'android', scope: 'all' });
    expect(last('satellites')?.sats.map((s) => s.key)).toEqual(['GPS:14', 'GPS:5']);
    expect(last('fix')?.fix).toEqual({ numSvUsed: 1 });
    expect(last('connection')?.state).toEqual({ kind: 'receiving' });

    native.fire('onLocation', {
      lat: 1,
      lon: 2,
      alt: 3,
      timeMs: 5,
      elapsedRealtimeNanos: 0,
      isMock: false,
    });
    expect(last('fix')).toMatchObject({ origin: 'android', fix: { fixType: '3d', lat: 1 } });

    native.fire('onFirstFix', { ttffMs: 4200 });
    expect(last('ttff')).toEqual({ t: 'ttff', ms: 4200 });

    // No satellites used → no fix (Android has no explicit "fix lost").
    native.fire('onGnssStatus', { sats: [sv({ usedInFix: false })], atMs: 20 });
    expect(last('fix')?.fix).toEqual({ fixType: 'none', numSvUsed: 0 });
    expect(events.filter((e) => e.t === 'connection' && e.state.kind === 'receiving')).toHaveLength(
      1,
    );
  });

  it('uses the phone NMEA only for DOP, MSL altitude and TXT (technical spec §7.2)', async () => {
    const { native, events } = await setup();
    const before = events.length;
    native.fire('onNmea', {
      lines: [
        'GPGGA,120000.00,0121.1,N,10349.1,E,1,05,1.0,32.4,M,7.5,M,,',
        'GPGSA,A,3,14,,,,,,,,,,,,1.4,0.8,1.2',
        'GPGSV,1,1,01,14,45,090,30',
        'GPTXT,01,01,02,hello',
      ].map((l) => ({ timestampMs: 0, line: withChecksum(l) })),
    });
    const added = events.slice(before).filter((e) => e.t !== 'console');
    expect(added.map((e) => e.t).sort()).toEqual(['dop', 'fix', 'info']);
    // Every sentence is shown in the Console (functional spec §8).
    const console = events.slice(before).find((e) => e.t === 'console');
    expect(console?.t === 'console' && console.entries.map((x) => x.name)).toEqual([
      'GPGGA',
      'GPGSA',
      'GPGSV',
      'GPTXT',
    ]);
    expect(added.find((e) => e.t === 'fix')).toEqual({
      t: 'fix',
      origin: 'nmea',
      fix: { altMslM: 32.4 },
    });
    expect(added.find((e) => e.t === 'dop')).toMatchObject({ origin: 'android-nmea' });

    // Once Location provides MSL altitude, NMEA altitude is ignored.
    native.fire('onLocation', {
      lat: 1,
      lon: 2,
      altMsl: 30,
      timeMs: 5,
      elapsedRealtimeNanos: 0,
      isMock: false,
    });
    const mark = events.length;
    native.fire('onNmea', {
      lines: [
        {
          timestampMs: 0,
          line: withChecksum('GPGGA,120001.00,0121.1,N,10349.1,E,1,05,1.0,32.4,M,7.5,M,,'),
        },
      ],
    });
    expect(events.slice(mark).some((e) => e.t === 'fix')).toBe(false);
  });

  it('tracks what the session has observed', async () => {
    const { native, last } = await setup();
    native.fire('onNmea', { lines: [] });
    native.fire('onGnssStatus', {
      sats: [
        sv({ carrierHz: 1575.42e6, usedInFix: true }),
        sv({ carrierHz: 1176.45e6 }),
        sv({ constellationType: 6, svid: 4 }),
      ],
      atMs: 0,
    });
    expect(last('android')?.patch).toMatchObject({
      observed: {
        constellations: ['GPS', 'GALILEO'],
        bands: ['L1', 'L5'],
        dualFrequency: true,
        nmeaOutput: true,
        maxSvUsed: 1,
      },
      statusUpdates: 1,
    });
  });

  it.each([
    ['denied', /needed/],
    ['blocked', /app settings/],
    ['approximate', /Precise location/],
  ] as const)('reports a %s permission without starting GNSS', async (permission, message) => {
    const { native, last } = await setup(permission);
    expect(native.start).not.toHaveBeenCalled();
    expect(last('connection')?.state).toMatchObject({
      kind: 'error',
      code: 'E_PERMISSION',
      message: expect.stringMatching(message),
    });
  });

  it('reports missing GNSS hardware or native module', async () => {
    const { last } = await setup(
      'granted',
      (n) => (n.device = { ...DEVICE, hasGnssFeature: false }),
    );
    expect(last('connection')?.state).toMatchObject({ code: 'E_NO_GNSS_HW' });

    const events: GnssEvent[] = [];
    await new AndroidLocationSource({ native: null, permissions: permissions('granted') }).start(
      (e) => events.push(e),
    );
    expect(events.pop()).toMatchObject({
      state: { code: 'E_NO_GNSS_HW', message: expect.stringMatching(/not available/) },
    });
  });

  it('waits for location to be turned on and stops when it is turned off (REQ-AND-02)', async () => {
    const { native, last } = await setup(
      'granted',
      (n) => (n.provider = { locationEnabled: false, gpsProviderEnabled: true }),
    );
    expect(native.start).not.toHaveBeenCalled();
    expect(last('connection')?.state).toMatchObject({ code: 'E_PROVIDER_DISABLED' });

    native.fire('onProviderChanged', { locationEnabled: true, gpsProviderEnabled: true });
    await Promise.resolve();
    expect(native.start).toHaveBeenCalledTimes(1);

    native.fire('onProviderChanged', { locationEnabled: true, gpsProviderEnabled: false });
    await new Promise<void>((r) => setImmediate(r));
    expect(native.stop).toHaveBeenCalledTimes(1);
    expect(last('connection')?.state).toMatchObject({ code: 'E_PROVIDER_DISABLED' });
  });

  it('stops GNSS in the background and restarts it in the foreground (REQ-AND-08)', async () => {
    const { native, source } = await setup();
    await source.suspend();
    expect(native.stop).toHaveBeenCalledTimes(1);
    await source.resume();
    expect(native.start).toHaveBeenCalledTimes(2);
  });

  it('completes the start after the user grants permission in the app settings', async () => {
    const { native, perms, source, last } = await setup('blocked');
    await source.suspend();
    perms.state = 'granted';
    await source.resume();
    expect(native.start).toHaveBeenCalledTimes(1);
    expect(last('connection')?.state).toEqual({ kind: 'detecting' });

    // Still blocked on another resume: stays in the permission error, no prompt.
    const second = await setup('blocked');
    await second.source.resume();
    expect(second.perms.request).toHaveBeenCalledTimes(1);
    expect(second.last('connection')?.state).toMatchObject({ code: 'E_PERMISSION' });
  });

  it('reports a native start failure', async () => {
    const { last } = await setup('granted', (n) => {
      n.start = jest.fn(async () => {
        throw Object.assign(new Error('nope'), { code: 'E_PERMISSION' });
      });
    });
    expect(last('connection')?.state).toMatchObject({ code: 'E_PERMISSION' });

    const other = await setup('granted', (n) => {
      n.start = jest.fn(async () => {
        throw new Error('GNSS engine unavailable');
      });
    });
    expect(other.last('connection')?.state).toEqual({
      kind: 'error',
      code: 'E_IO',
      message: 'GNSS engine unavailable',
    });
  });

  it('removes listeners and stops GNSS on stop', async () => {
    const { native, source, last } = await setup();
    expect(native.listenerCount).toBe(5);
    await source.stop();
    expect(native.listenerCount).toBe(0);
    expect(native.stop).toHaveBeenCalled();
    expect(last('connection')?.state).toEqual({ kind: 'idle' });
  });
});

describe('error actions (functional spec §10)', () => {
  it('maps error codes to banner actions', () => {
    expect(errorActionKind('E_PERMISSION')).toBe('allowLocation');
    expect(errorActionKind('E_PROVIDER_DISABLED')).toBe('turnOnLocation');
    expect(errorActionKind('E_IO')).toBe('retry');
  });
});
