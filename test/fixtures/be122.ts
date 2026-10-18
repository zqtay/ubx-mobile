/**
 * Real data recorded from the Beitian BE-122 (u-blox M10, firmware SPG 5.10) with u-center 2.
 * Source: docs/examples/be-122-dump.txt. Each entry is "class id len(LE) payload" as hex, i.e.
 * a UBX frame without sync bytes and checksum.
 */
import { buildUbx } from '@/protocols/ubx/builder';

export const BE122_MON_VER_HEX =
  '0A 04 A0 00 52 4F 4D 20 53 50 47 20 35 2E 31 30 20 28 37 62 32 30 32 65 29 00 00 00 00 00 00 00 00 00 30 30 30 41 30 30 30 30 00 00 46 57 56 45 52 3D 53 50 47 20 35 2E 31 30 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 50 52 4F 54 56 45 52 3D 33 34 2E 31 30 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 47 50 53 3B 47 4C 4F 3B 47 41 4C 3B 42 44 53 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 53 42 41 53 3B 51 5A 53 53 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00';

/** Turns a dump line ("cls id lenLo lenHi payload…") into a complete UBX frame. */
export function frameFromDump(hex: string): Uint8Array {
  const bytes = hex
    .trim()
    .split(/\s+/)
    .map((b) => parseInt(b, 16));
  const length = bytes[2] | (bytes[3] << 8);
  const payload = Uint8Array.from(bytes.slice(4));
  if (payload.length !== length)
    throw new Error(`Dump length ${length} != payload ${payload.length}`);
  return buildUbx(bytes[0], bytes[1], payload);
}
