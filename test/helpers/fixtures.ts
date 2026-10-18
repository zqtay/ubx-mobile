/**
 * Synthetic protocol fixtures for unit tests. Frames are built with the production builder so
 * checksums are always valid; tests corrupt them explicitly where needed.
 */
import { ascii } from '@/protocols/bytes';
import { withChecksum } from '@/protocols/nmea/checksum';
import { crc24q } from '@/protocols/rtcm/crc24q';

export { ascii, concat } from '@/protocols/bytes';
export * from '@/protocols/ubx/encoders';

/** NMEA sentence (body without `$` and checksum) → bytes with checksum and CRLF. */
export const nmea = (body: string): Uint8Array => ascii(`${withChecksum(body)}\r\n`);

/** One epoch of u-blox M10-style NMEA 4.11 output: GPS + Galileo + BeiDou, 5 satellites. */
export const SAMPLE_EPOCH_NMEA = [
  'GNRMC,113902.00,A,0121.12500,N,10349.19000,E,0.025,,181026,,,A,V',
  'GNVTG,,T,,M,0.025,N,0.046,K,A',
  'GNGGA,113902.00,0121.12500,N,10349.19000,E,1,05,0.78,32.4,M,7.5,M,,',
  'GNGSA,A,3,14,17,30,,,,,,,,,,1.42,0.78,1.18,1',
  'GNGSA,A,3,16,,,,,,,,,,,,1.42,0.78,1.18,3',
  'GNGSA,A,3,,,,,,,,,,,,,1.42,0.78,1.18,4',
  'GPGSV,1,1,03,14,07,312,25,17,34,257,19,30,17,330,21,1',
  'GAGSV,1,1,01,16,12,304,26,7',
  'GBGSV,1,1,01,21,05,277,24,1',
  'GNGLL,0121.12500,N,10349.19000,E,113902.00,A,A',
];

/** A valid RTCM 3 frame (message type 1005, zero payload body) for decoder tests. */
export function rtcm1005(): Uint8Array {
  // Preamble, 10-bit length, payload (message type in the first 12 bits), CRC-24Q.
  const payload = new Uint8Array(19);
  payload[0] = 1005 >> 4;
  payload[1] = (1005 & 0x0f) << 4;
  const frame = new Uint8Array(3 + payload.length + 3);
  frame[0] = 0xd3;
  frame[1] = 0;
  frame[2] = payload.length;
  frame.set(payload, 3);
  const crc = crc24q(frame, 0, 3 + payload.length);
  frame[3 + payload.length] = (crc >> 16) & 0xff;
  frame[4 + payload.length] = (crc >> 8) & 0xff;
  frame[5 + payload.length] = crc & 0xff;
  return frame;
}
