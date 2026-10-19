/**
 * Decoding benchmark for the performance budget (technical spec §7.4, M7.1): a 921600-baud
 * stream (≈ 92 KB/s) of 10 Hz NMEA + UBX epochs with 60 satellites and 120 signals, through the
 * protocol pipeline and the accumulator, with snapshots at the UI refresh rate.
 *
 * Run with `npm run bench`. Node's JIT is several times faster than Hermes on a phone, so the
 * result is an upper bound for the phone only after scaling (see the printed estimate); the
 * real check is the Hermes profiler on the reference device.
 */
import { ProtocolPipeline } from '@/protocols/pipeline';
import { GnssAccumulator } from '@/state/GnssAccumulator';

import { buildUbx } from '@/protocols/ubx/builder';

import { concat, navDop, navPvt, navSat, navSig, navStatus, nmea } from '../test/helpers/fixtures';

const BYTES_PER_SECOND = 92_160; // 921600 baud, 8N1
const EPOCHS_PER_SECOND = 10;
const SECONDS = 20;
/** Assumed Hermes (phone) slowdown versus Node's JIT for this kind of code. */
const HERMES_FACTOR = 8;

/**
 * Raw measurements (UBX-RXM-MEASX-like, class 0x02): framed and checksummed but not interpreted,
 * as a receiver streaming raw data for logging would send. Fills the link to 921600 baud.
 */
function filler(bytes: number): Uint8Array {
  const payload = new Uint8Array(Math.max(0, bytes - 8)).map((_, i) => i & 0xff);
  return buildUbx(0x02, 0x14, payload);
}

function epoch(i: number): Uint8Array {
  const itow = 100_000_000 + i * 100;
  const sats = Array.from({ length: 60 }, (_, k) => ({
    gnssId: [0, 2, 3, 6][k % 4],
    svId: 1 + (k % 30),
    cno: 20 + (k % 30),
    elev: 5 + (k % 80),
    azim: (k * 37) % 360,
    used: k % 3 === 0,
  }));
  const sigs = sats.flatMap((s) => [
    { gnssId: s.gnssId, svId: s.svId, sigId: 0, cno: s.cno, prUsed: s.used },
    { gnssId: s.gnssId, svId: s.svId, sigId: s.gnssId === 0 ? 3 : 1, cno: s.cno - 3 },
  ]);
  const gsv = Array.from({ length: 15 }, (_, k) =>
    nmea(`GPGSV,15,${k + 1},60,${k * 4 + 1},45,090,40,${k * 4 + 2},30,180,35,${k * 4 + 3},15,270,30,${k * 4 + 4},60,000,45,1`),
  );
  return concat(
    nmea('GNRMC,113902.00,A,0121.12500,N,10349.19000,E,0.025,,181026,,,A,V'),
    nmea('GNGGA,113902.00,0121.12500,N,10349.19000,E,1,24,0.78,32.4,M,7.5,M,,'),
    nmea('GNGSA,A,3,01,02,03,04,05,06,07,08,09,10,11,12,1.42,0.78,1.18,1'),
    ...gsv,
    navPvt({ numSV: 24, iTOW: itow }),
    navSat(sats, itow),
    navSig(sigs, itow),
    navDop(undefined, itow),
    navStatus(26_000, itow),
  );
}

function time(label: string, fn: () => void): number {
  fn(); // warm-up (JIT)
  const t0 = performance.now();
  fn();
  const ms = (performance.now() - t0) / SECONDS;
  console.log(`${label.padEnd(28)} ${ms.toFixed(1)} ms per second of data`);
  return ms;
}

it('decodes a 921600-baud stream within budget', () => {
  // 10 epochs per second with every satellite and signal, topped up with raw measurements to
  // the link rate (the budget's case: a full 921600-baud stream at 10 Hz).
  const perSecond = EPOCHS_PER_SECOND;
  const epochs = Array.from({ length: perSecond }, (_, i) => epoch(i));
  const used = epochs.reduce((n, e) => n + e.length, 0);
  const pad = Math.floor((BYTES_PER_SECOND - used) / perSecond);
  const second = concat(...epochs.flatMap((e) => (pad > 8 ? [e, filler(pad)] : [e])));
  // Deliver in USB-sized chunks (≈ 64 ms of data, as the native module batches).
  const chunk = Math.round(BYTES_PER_SECOND * 0.064);

  const pipeline = new ProtocolPipeline();
  const acc = new GnssAccumulator({ satelliteTimeoutMs: 5000 });
  acc.start('usb');
  const run = () => {
    for (let s = 0; s < SECONDS; s++) {
      for (let o = 0; o < second.length; o += chunk) {
        for (const e of pipeline.push(second.subarray(o, o + chunk), s * 1000 + o).events) {
          acc.apply(e);
        }
      }
      for (let r = 0; r < 5; r++) acc.snapshot(); // 5 Hz UI refresh
      acc.prune();
    }
  };
  // Stage breakdown, to see where the time goes.
  const { StreamDecoder } = jest.requireActual<typeof import('@/protocols/stream/StreamDecoder')>(
    '@/protocols/stream/StreamDecoder',
  );
  time('framing (StreamDecoder)', () => {
    const d = new StreamDecoder();
    for (let s = 0; s < SECONDS; s++)
      for (let o = 0; o < second.length; o += chunk) d.push(second.subarray(o, o + chunk), 0);
  });
  time('pipeline (framing + parse)', () => {
    const p = new ProtocolPipeline();
    for (let s = 0; s < SECONDS; s++)
      for (let o = 0; o < second.length; o += chunk) p.push(second.subarray(o, o + chunk), 0);
  });
  const msPerSecond = time('total (+ accumulator, UI)', run);
  const nodeShare = msPerSecond / 1000;
  const phoneShare = nodeShare * HERMES_FACTOR;
  console.log(
    [
      `stream: ${(second.length / 1024).toFixed(1)} KB/s, ${perSecond} epochs/s (60 SVs, 120 signals, NMEA + UBX, raw fill ${pad} B/epoch)`,
      `node:   ${msPerSecond.toFixed(1)} ms per second of data (${(nodeShare * 100).toFixed(2)}% of a core)`,
      `phone:  ≈ ${(phoneShare * 100).toFixed(1)}% of the JS thread at ×${HERMES_FACTOR} (budget 15%)`,
    ].join('\n'),
  );
  expect(phoneShare).toBeLessThan(0.15);
});
