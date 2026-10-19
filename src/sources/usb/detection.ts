import { UBX } from '@/protocols/ubx/ids';

import { buildMonitoringFrame } from './UbxClient';

/**
 * Baud rates tried by auto-baud, most likely first (technical spec §6.7). u-blox M10 modules
 * ship at 38400, but the real modules we have were reconfigured: the BE-122 runs at 57600 and the
 * BZ-251 at 115200 (docs/examples/*-dump.txt).
 */
export const AUTO_BAUD_ORDER: readonly number[] = [
  38400, 115200, 57600, 9600, 230400, 460800, 921600, 4800, 19200,
];

export interface BaudPlan {
  /** Baud remembered for this device from an earlier session. */
  remembered?: number;
  /** User setting: a fixed baud, or 'auto'. */
  setting: number | 'auto';
  /** Native USB (CDC-ACM) ignores the baud rate: only one attempt is needed. */
  nativeUsb: boolean;
}

/** Ordered, de-duplicated candidates. A fixed setting means only that rate is tried. */
export function baudCandidates(plan: BaudPlan): number[] {
  if (plan.setting !== 'auto') return [plan.setting];
  const first = plan.remembered ?? AUTO_BAUD_ORDER[0];
  if (plan.nativeUsb) return [first];
  return [...new Set([first, ...AUTO_BAUD_ORDER])];
}

/** What detection needs from the open serial port. */
export interface DetectionLink {
  setBaud(baud: number): Promise<void>;
  write(frame: Uint8Array): Promise<unknown>;
  /** Valid NMEA + UBX frames received so far (decoder statistics). */
  validFrames(): number;
  ubxFrames(): number;
  sleep(ms: number): Promise<void>;
}

export interface DetectionOptions {
  candidates: readonly number[];
  /** Send a UBX MON-VER poll when a baud rate is silent (default true). */
  probeUbx: boolean;
  /** How long to listen at each rate (default 1200 ms). */
  listenMs?: number;
  /** How long to wait for a reply after the probe (default 1000 ms). */
  probeMs?: number;
  /** Valid frames that confirm a baud rate (default 2). */
  minFrames?: number;
  /** Called before each attempt, for progress display. */
  onAttempt?: (baud: number) => void;
}

export interface DetectionResult {
  baud?: number;
  /** UBX frames were seen, so the receiver speaks UBX. */
  ubx: boolean;
}

/**
 * Finds the baud rate at which the receiver produces valid frames (technical spec §6.7).
 * Listening alone is not enough: a receiver can be configured to output nothing (the BE-122's
 * UART has NMEA and all UBX output off), so a silent rate is probed with a UBX MON-VER poll.
 * Junk never counts — only frames that pass their checksum.
 */
export async function detectBaud(
  link: DetectionLink,
  options: DetectionOptions,
): Promise<DetectionResult> {
  const listenMs = options.listenMs ?? 1200;
  const probeMs = options.probeMs ?? 1000;
  const minFrames = options.minFrames ?? 2;
  const probe = buildMonitoringFrame(UBX.MON_VER);

  for (const baud of options.candidates) {
    options.onAttempt?.(baud);
    await link.setBaud(baud);
    const startFrames = link.validFrames();
    const startUbx = link.ubxFrames();
    await link.sleep(listenMs);
    if (link.validFrames() - startFrames >= minFrames) {
      return { baud, ubx: link.ubxFrames() > startUbx };
    }
    if (options.probeUbx) {
      await link.write(probe);
      await link.sleep(probeMs);
      if (link.ubxFrames() > startUbx) return { baud, ubx: true };
    }
  }
  return { ubx: false };
}
