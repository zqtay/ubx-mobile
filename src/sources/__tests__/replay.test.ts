import type { GnssEvent } from '@/domain/events';
import { ascii } from '@/protocols/bytes';
import { ProtocolPipeline } from '@/protocols/pipeline';
import { emptySnapshot, useGnssStore } from '@/state/gnssStore';
import { GnssAccumulator } from '@/state/GnssAccumulator';

import { concat, navPvt, nmea, SAMPLE_EPOCH_NMEA } from '../../../test/helpers/fixtures';
import { buildDemoLog } from '../replay/demoLog';
import { splitEpochs } from '../replay/epochs';
import { ReplaySource } from '../replay/ReplaySource';
import { SourceManager } from '../SourceManager';

describe('demo log (REQ-SRC-05)', () => {
  const log = buildDemoLog({ epochs: 20 });

  it('is deterministic for a seed', () => {
    expect(buildDemoLog({ epochs: 20 })).toEqual(log);
    expect(buildDemoLog({ epochs: 20, seed: 7 })).not.toEqual(log);
  });

  it('decodes cleanly into a u-blox M10 with a fix after acquisition', () => {
    let t = 0;
    const acc = new GnssAccumulator({ satelliteTimeoutMs: 5000, now: () => t });
    acc.start('replay');
    const pipeline = new ProtocolPipeline();
    for (const { start, end } of splitEpochs(log)) {
      t += 1000;
      acc.applyAll(pipeline.push(log.subarray(start, end), t).events);
    }
    const snap = acc.snapshot();
    expect(snap.stats).toMatchObject({ nmeaChecksumErrors: 0, ubxChecksumErrors: 0, junkBytes: 0 });
    expect(snap.device.receiver).toMatchObject({
      vendor: 'u-blox',
      fwVersion: 'SPG 5.10',
      nmeaVersion: '4.10+',
    });
    expect(snap.fix).toMatchObject({ fixType: '3d', fixOk: true });
    expect(snap.session).toMatchObject({ ttffMs: 3240, ttffSource: 'receiver' });
    const constellations = new Set(snap.satellites.map((s) => s.constellation));
    expect([...constellations].sort()).toEqual([
      'BEIDOU',
      'GALILEO',
      'GLONASS',
      'GPS',
      'QZSS',
      'SBAS',
    ]);
    expect(snap.satellites.find((s) => s.key === 'GALILEO:27')?.health).toBe('unhealthy');
    expect(snap.satellites.find((s) => s.key === 'BEIDOU:25')).toMatchObject({
      orbitSource: 'none',
      elevation: undefined,
    });
    expect(snap.satellites.find((s) => s.key === 'BEIDOU:6')?.signals.map((s) => s.code)).toEqual([
      'B1I',
      'B1C',
    ]);
    expect(snap.satellites.filter((s) => s.used).length).toBeGreaterThanOrEqual(8);
  });

  it('splits into one epoch per second', () => {
    expect(splitEpochs(log)).toHaveLength(20);
  });
});

describe('splitEpochs', () => {
  it('uses NMEA time when the log has no UBX navigation messages', () => {
    const second = SAMPLE_EPOCH_NMEA.map((s) => s.replace(/113902/g, '113903'));
    const log = concat(...SAMPLE_EPOCH_NMEA.map(nmea), ...second.map(nmea));
    const epochs = splitEpochs(log);
    expect(epochs).toHaveLength(2);
    expect(epochs[0].start).toBe(0);
    expect(epochs[1].end).toBe(log.length);
  });

  it('keeps leading frames and trailing junk inside the first and last epochs', () => {
    const log = concat(
      ascii('junk'),
      navPvt({ iTOW: 1000 }),
      navPvt({ iTOW: 2000 }),
      ascii('tail'),
    );
    expect(splitEpochs(log)).toEqual([
      { start: 0, end: 4 + 100 },
      { start: 104, end: log.length },
    ]);
    expect(splitEpochs(new Uint8Array(0))).toEqual([]);
  });
});

describe('ReplaySource + SourceManager', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.useRealTimers();
    useGnssStore.setState(emptySnapshot(), true);
  });

  it('plays epochs at 1 Hz into the store and stops cleanly (REQ-SRC-02)', async () => {
    const manager = new SourceManager({ refreshHz: 2, satelliteTimeoutMs: 5000 });
    await manager.start(new ReplaySource(() => buildDemoLog({ epochs: 10 }), { label: 'Demo' }));
    expect(useGnssStore.getState().source).toBe('replay');

    jest.advanceTimersByTime(5000);
    const snap = useGnssStore.getState();
    expect(snap.connection).toEqual({ kind: 'receiving' });
    expect(snap.fix?.fixType).toBe('3d');
    expect(snap.satellites.length).toBeGreaterThan(15);

    await manager.stop();
    expect(useGnssStore.getState()).toEqual(emptySnapshot());
    manager.dispose();
  });

  it('loops or stops at the end of the log, and pauses/resumes', async () => {
    const events: GnssEvent[] = [];
    const looping = new ReplaySource(() => buildDemoLog({ epochs: 3 }), { label: 'x', loop: true });
    await looping.start((e) => events.push(e));
    jest.advanceTimersByTime(5000);
    const ttffs = events.filter((e) => e.t === 'stats');
    expect(ttffs.length).toBeGreaterThan(3);
    await looping.suspend();
    const count = events.length;
    jest.advanceTimersByTime(3000);
    expect(events.length).toBe(count);
    await looping.resume();
    jest.advanceTimersByTime(1000);
    expect(events.length).toBeGreaterThan(count);
    await looping.stop();
    expect(events[events.length - 1]).toEqual({ t: 'connection', state: { kind: 'idle' } });

    const once: GnssEvent[] = [];
    const single = new ReplaySource(() => buildDemoLog({ epochs: 2 }), {
      label: 'y',
      loop: false,
      speed: 10,
    });
    await single.start((e) => once.push(e));
    jest.advanceTimersByTime(1000);
    expect(once[once.length - 1]).toEqual({ t: 'connection', state: { kind: 'idle' } });
  });

  it('reports an empty log as an error', async () => {
    const events: GnssEvent[] = [];
    await new ReplaySource(() => new Uint8Array(0), { label: 'empty' }).start((e) =>
      events.push(e),
    );
    expect(events.pop()).toMatchObject({
      t: 'connection',
      state: { kind: 'error', code: 'E_NO_DATA' },
    });
  });

  it('reports a source that fails to start', async () => {
    const manager = new SourceManager({ refreshHz: 2, satelliteTimeoutMs: 5000 });
    await manager.start(
      new ReplaySource(() => Promise.reject(new Error('boom')), { label: 'bad' }),
    );
    jest.advanceTimersByTime(600);
    expect(useGnssStore.getState().connection).toEqual({
      kind: 'error',
      code: 'E_IO',
      message: 'boom',
    });
    manager.setRefreshRate(5);
    manager.setSatelliteTimeout(1000);
    manager.restartSession();
    manager.dispose();
  });
});
