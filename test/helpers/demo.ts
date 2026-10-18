import type { GnssSnapshot } from '@/domain/types';
import { ProtocolPipeline } from '@/protocols/pipeline';
import { buildDemoLog } from '@/sources/replay/demoLog';
import { splitEpochs } from '@/sources/replay/epochs';
import { GnssAccumulator } from '@/state/GnssAccumulator';

/** Snapshot of the demo receiver after `epochs` seconds, for screen tests. */
export function demoSnapshot(epochs = 10): GnssSnapshot {
  const log = buildDemoLog({ epochs });
  let t = 0;
  const acc = new GnssAccumulator({ satelliteTimeoutMs: 60_000, now: () => t });
  acc.start('replay');
  const pipeline = new ProtocolPipeline();
  for (const { start, end } of splitEpochs(log)) {
    t += 1000;
    acc.applyAll(pipeline.push(log.subarray(start, end), t).events);
  }
  acc.apply({ t: 'connection', state: { kind: 'receiving' } });
  return acc.snapshot();
}
