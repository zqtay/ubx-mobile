import { concat, navPvt, nmea, rtcm1005 } from '../../../test/helpers/fixtures';
import { frameName, MessageTracker } from '../messageStats';
import { ProtocolPipeline } from '../pipeline';
import { StreamDecoder } from '../stream/StreamDecoder';

const frames = (bytes: Uint8Array, rxMs = 0) => new StreamDecoder().push(bytes, rxMs);

describe('message statistics (REQ-DEV-08)', () => {
  it('names UBX, NMEA and RTCM3 frames', () => {
    const [ubx, gsv, pubx, txt, rtcm] = frames(
      concat(navPvt(), nmea('GPGSV,1,1,00'), nmea('PUBX,00'), nmea('GNTXT'), rtcm1005()),
    );
    expect([ubx, gsv, pubx, txt, rtcm].map(frameName)).toEqual([
      'UBX-NAV-PVT',
      'GPGSV',
      'PUBX',
      'GNTXT',
      'RTCM3 1005',
    ]);
  });

  it('counts messages and computes rates and throughput over a sliding window', () => {
    const tracker = new MessageTracker(5000);
    for (let t = 0; t < 10_000; t += 100) {
      for (const f of frames(nmea('GNGGA,1'), t)) tracker.record(f); // 10 Hz
      if (t % 1000 === 0) for (const f of frames(navPvt(), t)) tracker.record(f); // 1 Hz
      tracker.recordBytes(50, t);
    }
    const { messages, bytesPerSecond } = tracker.snapshot(9_950);
    expect(messages.map((m) => m.name)).toEqual(['GNGGA', 'UBX-NAV-PVT']);
    expect(messages[0]).toMatchObject({ protocol: 'NMEA', count: 100, lastMs: 9900, rateHz: 10 });
    expect(messages[1]).toMatchObject({ protocol: 'UBX', count: 10, rateHz: 1 });
    expect(bytesPerSecond).toBe(500);

    // Silence: rates decay to zero, counts remain.
    const later = tracker.snapshot(30_000);
    expect(later.messages[0]).toMatchObject({ count: 100, rateHz: 0 });
    expect(later.bytesPerSecond).toBe(0);

    tracker.reset();
    expect(tracker.snapshot(0).messages).toEqual([]);
  });

  it('is reported in the pipeline stream statistics', () => {
    const pipeline = new ProtocolPipeline();
    const { events } = pipeline.push(concat(navPvt(), nmea('GNGGA,1')), 1000);
    const stats = events.find((e) => e.t === 'stats');
    expect(stats).toMatchObject({
      stats: {
        messages: [
          { name: 'GNGGA', count: 1 },
          { name: 'UBX-NAV-PVT', count: 1 },
        ],
      },
    });
    expect(stats?.t === 'stats' && stats.stats.bytesPerSecond).toBeGreaterThan(0);
  });
});
