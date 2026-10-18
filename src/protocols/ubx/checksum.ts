/**
 * UBX 8-bit Fletcher checksum over `bytes[start, end)` (class, id, length and payload).
 * Returns CK_A in the low byte and CK_B in the high byte.
 */
export function ubxChecksum(bytes: Uint8Array, start: number, end: number): number {
  let a = 0;
  let b = 0;
  for (let i = start; i < end; i++) {
    a = (a + bytes[i]) & 0xff;
    b = (b + a) & 0xff;
  }
  return a | (b << 8);
}
