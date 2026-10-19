import type { DecodedFrame } from '@/protocols/stream/StreamDecoder';
import { buildUbx } from '@/protocols/ubx/builder';
import { UBX, ubxMessageName } from '@/protocols/ubx/ids';

export type UbxMessage = readonly [number, number];

const key = ([cls, id]: UbxMessage) => (cls << 8) | id;

/** Navigation data polled every second in Poll mode (technical spec §6.6). */
export const PERIODIC_POLLS: readonly UbxMessage[] = [
  UBX.NAV_PVT,
  UBX.NAV_SAT,
  UBX.NAV_SIG,
  UBX.NAV_DOP,
  UBX.NAV_STATUS,
];

/** Rarely changing data, polled every SLOW_POLL_TICKS scheduler ticks. */
export const SLOW_POLLS: readonly UbxMessage[] = [UBX.NAV_TIMELS];
const SLOW_POLL_TICKS = 30;

/** Identity and RF status, polled once after detection. */
export const IDENTITY_POLLS: readonly UbxMessage[] = [
  UBX.MON_VER,
  UBX.SEC_UNIQID,
  UBX.MON_GNSS,
  UBX.MON_RF,
];

/** Fallbacks when a message is not supported (older generations). */
const FALLBACK = new Map<number, UbxMessage>([
  [key(UBX.NAV_SAT), UBX.NAV_SVINFO],
  [key(UBX.MON_RF), UBX.MON_HW],
]);

/** Messages the monitoring channel may poll (empty payload). Everything is read-only. */
const MONITOR_POLLABLE = new Set<number>(
  [...PERIODIC_POLLS, ...IDENTITY_POLLS, UBX.NAV_SVINFO, UBX.NAV_TIMELS, UBX.MON_HW].map(key),
);

export class MonitoringChannelError extends Error {}

/** Messages the configuration channel may send (functional spec §11; never UPD-* / firmware). */
const CONFIG_WRITABLE = new Set<number>(
  [UBX.CFG_VALSET, UBX.CFG_VALDEL, UBX.CFG_CFG, UBX.CFG_RST].map(key),
);

/** Messages acknowledged with ACK-ACK/NAK. CFG-RST is not acknowledged. */
const ACKED = new Set<number>([UBX.CFG_VALSET, UBX.CFG_VALDEL, UBX.CFG_CFG].map(key));

export type ConfigAction =
  | 'apply'
  | 'save'
  | 'revert'
  | 'restart'
  | 'factory-reset'
  | 'restore'
  /** Opt-in periodic UBX output in RAM (REQ-SER-09). */
  | 'periodic-output';

/**
 * A configuration write (technical spec §6.6). Created only by the configuration service in
 * response to a user action; the monitoring code never constructs one.
 */
export class ConfigWriteRequest {
  constructor(
    readonly action: ConfigAction,
    readonly frames: readonly Uint8Array[],
    readonly description: string,
  ) {
    for (const f of frames) {
      if (f.length < 8 || !CONFIG_WRITABLE.has((f[2] << 8) | f[3])) {
        throw new MonitoringChannelError(
          `${ubxMessageName(f[2], f[3])} is not allowed on the configuration channel`,
        );
      }
    }
  }
}

export type FrameOutcome = 'ack' | 'nak' | 'timeout' | 'sent';

export interface ConfigWriteResult {
  ok: boolean;
  outcomes: FrameOutcome[];
}

/**
 * Builds a frame for the monitoring channel (REQ-SER-08). Only polls of read-only messages and
 * CFG-VALGET (a configuration read) are allowed; anything that could change the receiver —
 * CFG-VALSET/VALDEL/CFG/RST/MSG, UPD-*, or a payload on a poll — is refused.
 */
export function buildMonitoringFrame(msg: UbxMessage, payload?: Uint8Array): Uint8Array {
  if (key(msg) === key(UBX.CFG_VALGET)) {
    if (!payload || payload.length < 4)
      throw new MonitoringChannelError('CFG-VALGET needs a request payload');
    return buildUbx(msg[0], msg[1], payload);
  }
  if (payload && payload.length > 0) {
    throw new MonitoringChannelError(
      `${ubxMessageName(msg[0], msg[1])} with a payload is not a poll`,
    );
  }
  if (!MONITOR_POLLABLE.has(key(msg))) {
    throw new MonitoringChannelError(
      `${ubxMessageName(msg[0], msg[1])} is not allowed on the monitoring channel`,
    );
  }
  return buildUbx(msg[0], msg[1]);
}

interface Pending {
  promise: Promise<boolean>;
  resolve: (ok: boolean) => void;
  timer?: ReturnType<typeof setTimeout>;
  attempts: number;
}

export interface UbxClientOptions {
  /** Monotonic clock. */
  now?: () => number;
  /** Time to wait for a response before retrying (default 1500 ms). */
  timeoutMs?: number;
  /** Retries after the first attempt (default 2). */
  retries?: number;
  /** Consecutive failed polls before a message is considered unsupported (default 3). */
  failuresBeforeUnsupported?: number;
}

/**
 * Outgoing traffic to a u-blox receiver on the monitoring channel (technical spec §6.6):
 * request tracking with retries, capability learning (NAK or repeated timeouts → unsupported,
 * with fallbacks), and a 1 Hz poll scheduler that skips messages the receiver already outputs.
 * The configuration channel (M5b) is separate and not part of this class.
 */
export class UbxClient {
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly failuresBeforeUnsupported: number;
  private readonly pending = new Map<number, Pending>();
  private readonly unsupported = new Set<number>();
  private readonly failures = new Map<number, number>();
  private readonly lastUnsolicited = new Map<number, number>();
  private readonly lastSeen = new Map<number, number>();
  private readonly ackWaiters = new Map<number, (outcome: 'ack' | 'nak') => void>();
  private readonly frameWaiters = new Set<{
    match: (f: Extract<DecodedFrame, { kind: 'ubx' }>) => boolean;
    resolve: (f: Extract<DecodedFrame, { kind: 'ubx' }>) => void;
  }>();
  private queue: Promise<unknown> = Promise.resolve();
  private scheduler?: ReturnType<typeof setInterval>;
  private paused = false;

  constructor(
    private readonly send: (frame: Uint8Array) => Promise<unknown>,
    options: UbxClientOptions = {},
  ) {
    this.now = options.now ?? (() => Date.now());
    this.timeoutMs = options.timeoutMs ?? 1500;
    this.retries = options.retries ?? 2;
    this.failuresBeforeUnsupported = options.failuresBeforeUnsupported ?? 3;
  }

  /** Feed every decoded frame from the receiver. */
  onFrame(frame: DecodedFrame): void {
    if (frame.kind !== 'ubx') return;
    const k = (frame.cls << 8) | frame.id;
    this.lastSeen.set(k, this.now());
    for (const w of this.frameWaiters) {
      if (w.match(frame)) {
        this.frameWaiters.delete(w);
        w.resolve(frame);
      }
    }
    const isAck = k === key(UBX.ACK_ACK);
    if ((isAck || k === key(UBX.ACK_NAK)) && frame.payload.length >= 2) {
      const target = (frame.payload[0] << 8) | frame.payload[1];
      const waiter = this.ackWaiters.get(target);
      if (waiter) {
        this.ackWaiters.delete(target);
        waiter(isAck ? 'ack' : 'nak');
      }
      // Only a NAK answering one of our polls means "unsupported".
      if (!isAck && this.pending.has(target)) {
        this.unsupported.add(target);
        this.settle(target, false);
      }
      return;
    }
    if (this.pending.has(k)) {
      this.failures.delete(k);
      this.settle(k, true);
    } else {
      this.lastUnsolicited.set(k, this.now());
    }
  }

  isSupported(msg: UbxMessage): boolean {
    return !this.unsupported.has(key(msg));
  }

  /** True if the message was received at all within the last `withinMs`. */
  seenRecently(msg: UbxMessage, withinMs: number): boolean {
    const at = this.lastSeen.get(key(msg));
    return at !== undefined && this.now() - at <= withinMs;
  }

  /** The message to use for `msg`, following fallbacks for unsupported messages. */
  effective(msg: UbxMessage): UbxMessage | undefined {
    let current: UbxMessage | undefined = msg;
    while (current && this.unsupported.has(key(current))) current = FALLBACK.get(key(current));
    return current;
  }

  /**
   * Polls a message. Resolves true when it arrives, false after a NAK or when all retries time
   * out. Concurrent polls of the same message share one request.
   */
  poll(msg: UbxMessage): Promise<boolean> {
    const k = key(msg);
    if (this.unsupported.has(k)) return Promise.resolve(false);
    const existing = this.pending.get(k);
    if (existing) return existing.promise;
    const frame = buildMonitoringFrame(msg);
    let resolve!: (ok: boolean) => void;
    const promise = new Promise<boolean>((r) => (resolve = r));
    const entry: Pending = { promise, resolve, attempts: 0 };
    this.pending.set(k, entry);
    this.attempt(k, entry, frame);
    return promise;
  }

  /** Polls the identity messages once, following fallbacks (MON-RF → MON-HW). */
  async pollIdentity(): Promise<void> {
    for (const msg of IDENTITY_POLLS) {
      if (this.paused) return;
      let current: UbxMessage | undefined = msg;
      while (current && !(await this.poll(current))) {
        current = this.unsupported.has(key(current)) ? FALLBACK.get(key(current)) : undefined;
      }
    }
  }

  /** Starts polling navigation data every `intervalMs` (Poll mode, the default). */
  startScheduler(intervalMs = 1000): void {
    this.stopScheduler();
    let ticks = 0;
    const tick = () => {
      if (this.paused) return;
      const slow = ticks++ % SLOW_POLL_TICKS === 0 ? SLOW_POLLS : [];
      for (const msg of [...PERIODIC_POLLS, ...slow]) {
        const target = this.effective(msg);
        if (!target) continue;
        const k = key(target);
        if (this.pending.has(k)) continue;
        // The receiver already outputs it periodically: don't add polling load.
        const unsolicited = this.lastUnsolicited.get(k);
        if (unsolicited !== undefined && this.now() - unsolicited <= intervalMs * 1.5) continue;
        void this.poll(target);
      }
    };
    tick();
    this.scheduler = setInterval(tick, intervalMs);
  }

  stopScheduler(): void {
    if (this.scheduler) clearInterval(this.scheduler);
    this.scheduler = undefined;
  }

  /** Pauses polling while a configuration transaction is in flight (functional spec §11.7). */
  setPaused(paused: boolean): void {
    this.paused = paused;
    // Outstanding polls would keep retrying and mix with configuration ACKs: cancel them.
    if (paused) for (const k of [...this.pending.keys()]) this.settle(k, false);
  }

  /** Waits for the next UBX frame matching `match`, or undefined after `timeoutMs`. */
  waitForFrame(
    match: (f: Extract<DecodedFrame, { kind: 'ubx' }>) => boolean,
    timeoutMs: number,
  ): Promise<Extract<DecodedFrame, { kind: 'ubx' }> | undefined> {
    return new Promise((resolve) => {
      const waiter = {
        match,
        resolve: (f: Extract<DecodedFrame, { kind: 'ubx' }> | undefined) => {
          clearTimeout(timer);
          resolve(f);
        },
      };
      const timer = setTimeout(() => {
        this.frameWaiters.delete(waiter);
        resolve(undefined);
      }, timeoutMs);
      this.frameWaiters.add(waiter);
    });
  }

  /**
   * Reads configuration values (CFG-VALGET, read-only, monitoring channel). Requests are
   * serialised because responses carry no request identifier. Resolves the response payload,
   * 'nak' (e.g. an unknown key) or 'timeout'.
   */
  valget(payload: Uint8Array, timeoutMs = 1500): Promise<Uint8Array | 'nak' | 'timeout'> {
    const run = async () => {
      const frame = buildMonitoringFrame(UBX.CFG_VALGET, payload);
      const isNak = (f: Extract<DecodedFrame, { kind: 'ubx' }>) =>
        f.cls === UBX.ACK_NAK[0] &&
        f.id === UBX.ACK_NAK[1] &&
        f.payload[0] === UBX.CFG_VALGET[0] &&
        f.payload[1] === UBX.CFG_VALGET[1];
      const response = this.waitForFrame(
        (f) =>
          (f.cls === UBX.CFG_VALGET[0] &&
            f.id === UBX.CFG_VALGET[1] &&
            f.payload.length >= 4 &&
            f.payload[1] === payload[1]) ||
          isNak(f),
        timeoutMs,
      );
      await this.send(frame).catch(() => undefined);
      const f = await response;
      if (!f) return 'timeout' as const;
      return isNak(f) ? ('nak' as const) : f.payload;
    };
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => undefined);
    return result;
  }

  /**
   * Sends a configuration write (configuration channel, technical spec §6.6). Polling pauses for
   * the duration; each acknowledged message must be ACKed before the next is sent, and the write
   * stops at the first NAK.
   */
  configure(request: ConfigWriteRequest, ackTimeoutMs = 2000): Promise<ConfigWriteResult> {
    const run = async (): Promise<ConfigWriteResult> => {
      const wasPaused = this.paused;
      this.setPaused(true);
      const outcomes: FrameOutcome[] = [];
      try {
        for (const frame of request.frames) {
          const k = (frame[2] << 8) | frame[3];
          if (!ACKED.has(k)) {
            await this.send(frame);
            outcomes.push('sent');
            continue;
          }
          const ack = new Promise<FrameOutcome>((resolve) => {
            const timer = setTimeout(() => {
              this.ackWaiters.delete(k);
              resolve('timeout');
            }, ackTimeoutMs);
            this.ackWaiters.set(k, (o) => {
              clearTimeout(timer);
              resolve(o);
            });
          });
          await this.send(frame);
          const outcome = await ack;
          outcomes.push(outcome);
          if (outcome !== 'ack') break;
        }
      } finally {
        this.setPaused(wasPaused);
      }
      return {
        ok:
          outcomes.length === request.frames.length &&
          outcomes.every((o) => o === 'ack' || o === 'sent'),
        outcomes,
      };
    };
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => undefined);
    return result;
  }

  /** Stops the scheduler and fails all pending polls. */
  dispose(): void {
    this.stopScheduler();
    for (const w of [...this.frameWaiters]) w.resolve(undefined as never);
    this.frameWaiters.clear();
    for (const [k, w] of [...this.ackWaiters]) {
      this.ackWaiters.delete(k);
      w('nak');
    }
    for (const k of [...this.pending.keys()]) this.settle(k, false);
  }

  private attempt(k: number, entry: Pending, frame: Uint8Array): void {
    entry.attempts += 1;
    this.send(frame).catch(() => undefined);
    entry.timer = setTimeout(() => {
      if (this.pending.get(k) !== entry) return;
      if (entry.attempts <= this.retries) {
        this.attempt(k, entry, frame);
        return;
      }
      const failures = (this.failures.get(k) ?? 0) + 1;
      this.failures.set(k, failures);
      if (failures >= this.failuresBeforeUnsupported) this.unsupported.add(k);
      this.settle(k, false);
    }, this.timeoutMs);
  }

  private settle(k: number, ok: boolean): void {
    const entry = this.pending.get(k);
    if (!entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    this.pending.delete(k);
    entry.resolve(ok);
  }
}
