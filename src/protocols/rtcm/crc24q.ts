/** CRC-24Q (Qualcomm), used by RTCM 3 frames. */
const TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let crc = i << 16;
    for (let j = 0; j < 8; j++) {
      crc <<= 1;
      if (crc & 0x1000000) crc ^= 0x1864cfb;
    }
    table[i] = crc & 0xffffff;
  }
  return table;
})();

export function crc24q(bytes: Uint8Array, start: number, end: number): number {
  let crc = 0;
  for (let i = start; i < end; i++) {
    crc = ((crc << 8) & 0xffffff) ^ TABLE[((crc >> 16) ^ bytes[i]) & 0xff];
  }
  return crc;
}
