import type { GnssEvent } from '@/domain/events';
import type { SatObservation } from '@/domain/types';

import { GnssAccumulator } from '../GnssAccumulator';
import { emptySnapshot, startCommitLoop, useGnssStore } from '../gnssStore';

function setup(timeoutMs = 5000) {
  let t = 1000;
  const acc = new GnssAccumulator({ satelliteTimeoutMs: timeoutMs, now: () => t });
  acc.start('usb');
  return {
    acc,
    advance: (ms: number) => {
      t += ms;
    },
    sat: (key: string) => acc.snapshot().satellites.find((s) => s.key === key),
  };
}

const obs = (key: string, extra: Partial<SatObservation> = {}): SatObservation => {
  const [constellation, svid] = key.split(':');
  return {
    key,
    constellation: constellation as SatObservation['constellation'],
    svid: Number(svid),
    cn0: 30,
    ...extra,
  };
};

const sats = (
  origin: Extract<GnssEvent, { t: 'satellites' }>['origin'],
  list: SatObservation[],
): GnssEvent => ({
  t: 'satellites',
  origin,
  scope: 'all',
  sats: list,
});

describe('GnssAccumulator (technical spec §7.2)', () => {
  it('starts a clean session', () => {
    const { acc } = setup();
    const snap = acc.snapshot();
    expect(snap).toMatchObject({
      source: 'usb',
      connection: { kind: 'connecting' },
      satellites: [],
      stale: false,
    });
    expect(snap.session?.startedAtMs).toBe(1000);
  });

  it('prefers UBX satellite data over NMEA within the precedence window (REQ-SER-10)', () => {
    const { acc, advance, sat } = setup();
    acc.apply(
      sats('ubx-nav-sat', [
        obs('GPS:14', { cn0: 41, health: 'healthy', orbitSource: 'ephemeris' }),
      ]),
    );
    acc.apply(sats('nmea', [obs('GPS:14', { cn0: 25 })]));
    expect(sat('GPS:14')).toMatchObject({ cn0: 41, origin: 'ubx-nav-sat', health: 'healthy' });

    advance(3500); // UBX stopped: NMEA may take over.
    acc.apply(sats('nmea', [obs('GPS:14', { cn0: 25 })]));
    expect(sat('GPS:14')).toMatchObject({ cn0: 25, origin: 'nmea' });
    expect(sat('GPS:14')?.health).toBeUndefined();
  });

  it('applies the NMEA used-in-fix set only to NMEA-sourced satellites', () => {
    const { acc, sat } = setup();
    acc.apply(sats('ubx-nav-sat', [obs('GPS:1', { used: false })]));
    acc.apply(sats('nmea', [obs('GPS:2'), obs('GLONASS:3')]));
    acc.apply({ t: 'used', scope: 'all', keys: ['GPS:1', 'GPS:2'] });
    expect(sat('GPS:1')?.used).toBe(false);
    expect(sat('GPS:2')?.used).toBe(true);
    expect(sat('GLONASS:3')?.used).toBe(false);

    // A used set scoped to one constellation leaves the others alone.
    acc.apply({ t: 'used', scope: 'GLONASS', keys: ['GLONASS:3'] });
    expect(sat('GLONASS:3')?.used).toBe(true);
    expect(sat('GPS:2')?.used).toBe(true);
  });

  it('keeps the used flag across GSV updates and applies the last GSA set to new satellites', () => {
    const { acc, sat } = setup();
    acc.apply({ t: 'used', scope: 'all', keys: ['GPS:5'] });
    acc.apply(sats('nmea', [obs('GPS:5'), obs('GPS:6')]));
    expect(sat('GPS:5')?.used).toBe(true);
    expect(sat('GPS:6')?.used).toBe(false);
    acc.apply(sats('nmea', [obs('GPS:5', { cn0: 33 })]));
    expect(sat('GPS:5')).toMatchObject({ used: true, cn0: 33 });
  });

  it('merges per-signal NMEA observations and reports the strongest C/N0', () => {
    const { acc, sat } = setup();
    acc.apply(
      sats('nmea', [
        obs('GPS:14', {
          cn0: 41,
          signals: [{ code: 'L1CA', label: 'L1 C/A', cn0: 41, lastSeenMs: 1000 }],
        }),
      ]),
    );
    acc.apply(
      sats('nmea', [
        obs('GPS:14', {
          cn0: 44,
          signals: [{ code: 'L5Q', label: 'L5-Q', cn0: 44, lastSeenMs: 1000 }],
        }),
      ]),
    );
    expect(sat('GPS:14')?.signals.map((s) => s.code)).toEqual(['L1CA', 'L5Q']);
    expect(sat('GPS:14')?.cn0).toBe(44);
  });

  it('attaches NAV-SIG signals to NAV-SAT satellites and creates satellites seen only in NAV-SIG', () => {
    const { acc, sat } = setup();
    acc.apply(sats('ubx-nav-sat', [obs('GPS:14', { cn0: 41 })]));
    acc.apply({
      t: 'signals',
      signals: [
        {
          key: 'GPS:14',
          constellation: 'GPS',
          svid: 14,
          code: 'L1CA',
          label: 'L1C/A',
          cn0: 41,
          used: true,
        },
        { key: 'GPS:14', constellation: 'GPS', svid: 14, code: 'L2CL', label: 'L2 CL', cn0: 35 },
        {
          key: 'GALILEO:4',
          constellation: 'GALILEO',
          svid: 4,
          code: 'E1C',
          label: 'E1 C',
          cn0: 28,
          used: true,
        },
      ],
    });
    expect(sat('GPS:14')).toMatchObject({ cn0: 41, signals: [{ code: 'L1CA' }, { code: 'L2CL' }] });
    expect(sat('GALILEO:4')).toMatchObject({ cn0: 28, used: true, origin: 'ubx-nav-sat' });

    // A later NAV-SAT keeps the NAV-SIG signal list.
    acc.apply(sats('ubx-nav-sat', [obs('GPS:14', { cn0: 42 })]));
    expect(sat('GPS:14')?.signals).toHaveLength(2);
  });

  it('ages out satellites and lost signals (REQ-SAT-12)', () => {
    const { acc, advance, sat } = setup(5000);
    acc.apply(
      sats('nmea', [
        obs('GPS:1', {
          signals: [
            { code: 'L1CA', label: 'L1', cn0: 30, lastSeenMs: 1000 },
            { code: 'L5Q', label: 'L5', cn0: 40, lastSeenMs: 1000 },
          ],
        }),
      ]),
    );
    acc.snapshot();
    advance(3000);
    acc.apply(
      sats('nmea', [
        obs('GPS:1', { signals: [{ code: 'L1CA', label: 'L1', cn0: 30, lastSeenMs: 4000 }] }),
      ]),
    );
    advance(2500);
    expect(acc.prune()).toBe(true);
    expect(sat('GPS:1')).toMatchObject({ cn0: 30, signals: [{ code: 'L1CA' }] });
    expect(acc.prune()).toBe(false);
    advance(3000);
    acc.prune();
    expect(sat('GPS:1')).toBeUndefined();
  });

  it('merges partial fixes and lets UBX win over NMEA', () => {
    const { acc, advance } = setup();
    acc.apply({ t: 'fix', origin: 'nmea', fix: { fixType: '3d', lat: 1, lon: 2, altMslM: 10 } });
    acc.apply({ t: 'fix', origin: 'nmea', fix: { speedMps: 3 } });
    expect(acc.snapshot().fix).toMatchObject({
      fixType: '3d',
      lat: 1,
      lon: 2,
      speedMps: 3,
      receivedAtMs: 1000,
    });

    acc.apply({ t: 'fix', origin: 'ubx', fix: { fixType: '3d', lat: 1.5, lon: 2.5, fixOk: true } });
    acc.apply({ t: 'fix', origin: 'nmea', fix: { lat: 9 } });
    expect(acc.snapshot().fix?.lat).toBe(1.5);
    advance(4000);
    acc.apply({ t: 'fix', origin: 'nmea', fix: { lat: 9 } });
    expect(acc.snapshot().fix?.lat).toBe(9);
  });

  it('merges DOP updates with precedence', () => {
    const { acc } = setup();
    acc.apply({ t: 'dop', origin: 'ubx', dop: { g: 1.6, p: 1.4, h: 0.8, v: 1.2 } });
    acc.apply({ t: 'dop', origin: 'ubx', dop: { p: 1.5 } });
    acc.apply({ t: 'dop', origin: 'nmea', dop: { p: 9, h: 9 } });
    expect(acc.snapshot().dop).toEqual({ g: 1.6, p: 1.5, h: 0.8, v: 1.2 });
  });

  it('measures TTFF until the receiver reports one', () => {
    const { acc, advance } = setup();
    advance(28_000);
    acc.apply({ t: 'fix', origin: 'nmea', fix: { fixType: 'none' } });
    expect(acc.snapshot().session?.ttffMs).toBeUndefined();
    acc.apply({ t: 'fix', origin: 'nmea', fix: { fixType: '3d' } });
    expect(acc.snapshot().session).toMatchObject({ ttffMs: 28_000, ttffSource: 'measured' });
    acc.apply({ t: 'ttff', ms: 26_500 });
    expect(acc.snapshot().session).toMatchObject({ ttffMs: 26_500, ttffSource: 'receiver' });
  });

  it('collects receiver info, info messages, stats and connection state', () => {
    const { acc } = setup();
    acc.apply({ t: 'receiver', patch: { vendor: 'u-blox', module: 'MIA-M10Q' } });
    acc.apply({ t: 'receiver', patch: { uniqueId: 'AB', module: undefined } });
    for (let i = 0; i < 60; i++)
      acc.apply({ t: 'info', level: 'notice', text: `m${i}`, origin: 'NMEA GPTXT' });
    acc.apply({ t: 'stats', stats: { ...emptySnapshot().stats, bytes: 99 } });
    acc.apply({ t: 'connection', state: { kind: 'disconnected', atMs: 5 } });
    const snap = acc.snapshot();
    expect(snap.device.receiver).toMatchObject({
      vendor: 'u-blox',
      module: 'MIA-M10Q',
      uniqueId: 'AB',
    });
    expect(snap.device.receiver.infoMessages).toHaveLength(50);
    expect(snap.device.receiver.infoMessages?.[49].text).toBe('m59');
    expect(snap.stats.bytes).toBe(99);
    expect(snap.stale).toBe(true);
  });

  it('keeps object identity for unchanged satellites and caches clean snapshots', () => {
    const { acc } = setup();
    acc.apply(sats('ubx-nav-sat', [obs('GPS:1'), obs('GPS:2')]));
    const first = acc.snapshot();
    expect(acc.snapshot()).toBe(first);
    acc.apply({ t: 'used', scope: 'all', keys: [] });
    const second = acc.snapshot();
    expect(second).not.toBe(first);
    expect(second.satellites[0]).toBe(first.satellites[0]);
  });

  it('sorts satellites by constellation, then number', () => {
    const { acc } = setup();
    acc.apply(
      sats('ubx-nav-sat', [obs('GALILEO:3'), obs('GPS:20'), obs('GPS:2'), obs('BEIDOU:1')]),
    );
    expect(acc.snapshot().satellites.map((s) => s.key)).toEqual([
      'GPS:2',
      'GPS:20',
      'GALILEO:3',
      'BEIDOU:1',
    ]);
  });

  it('clears satellites and TTFF on a receiver restart but keeps identity', () => {
    const { acc } = setup();
    acc.apply({ t: 'receiver', patch: { module: 'M10' } });
    acc.apply(sats('ubx-nav-sat', [obs('GPS:1')]));
    acc.apply({ t: 'ttff', ms: 1000 });
    acc.restartSession();
    const snap = acc.snapshot();
    expect(snap.satellites).toEqual([]);
    expect(snap.session?.ttffMs).toBeUndefined();
    expect(snap.device.receiver.module).toBe('M10');
  });

  it('honours a changed satellite timeout', () => {
    const { acc, advance, sat } = setup(5000);
    acc.apply(sats('nmea', [obs('GPS:1')]));
    acc.setSatelliteTimeout(1000);
    advance(1500);
    acc.prune();
    expect(sat('GPS:1')).toBeUndefined();
  });
});

describe('published satellites stay immutable (performance: in-place patching)', () => {
  const signal = (cn0: number): GnssEvent => ({
    t: 'signals',
    signals: [{ key: 'GPS:14', constellation: 'GPS', svid: 14, code: 'L1CA', label: 'L1C/A', cn0 }],
  });

  it('patches only objects the UI has not received yet', () => {
    const { acc } = setup();
    acc.apply(sats('ubx-nav-sat', [obs('GPS:14', { cn0: 41 })]));
    acc.apply(signal(41)); // same refresh interval: patched in place
    const first = acc.snapshot().satellites[0];
    expect(first.signals[0].cn0).toBe(41);

    acc.apply(signal(20)); // after the snapshot: must not touch `first`
    const second = acc.snapshot().satellites[0];
    expect(first.signals[0].cn0).toBe(41);
    expect(second.signals[0].cn0).toBe(20);
    expect(second).not.toBe(first);

    acc.apply({ t: 'used', scope: 'all', keys: [] }); // no change for UBX origin
    expect(acc.snapshot().satellites[0]).toBe(second);
  });
});

describe('commit loop (REQ-NFR-03)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.useRealTimers();
    useGnssStore.setState(emptySnapshot(), true);
  });

  it('publishes snapshots to the store at the refresh rate, only when dirty', () => {
    const { acc } = setup();
    const stop = startCommitLoop(acc, 2);
    const first = useGnssStore.getState();
    expect(first.source).toBe('usb');

    jest.advanceTimersByTime(500);
    expect(useGnssStore.getState()).toBe(first);

    acc.apply(sats('nmea', [obs('GPS:7')]));
    expect(useGnssStore.getState().satellites).toHaveLength(0);
    jest.advanceTimersByTime(500);
    expect(useGnssStore.getState().satellites.map((s) => s.key)).toEqual(['GPS:7']);

    stop();
    acc.apply(sats('nmea', [obs('GPS:8')]));
    jest.advanceTimersByTime(2000);
    expect(useGnssStore.getState().satellites).toHaveLength(1);
  });
});
