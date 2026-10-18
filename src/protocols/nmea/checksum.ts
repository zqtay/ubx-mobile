/** XOR of all characters of an NMEA sentence body (between `$`/`!` and `*`). */
export function nmeaChecksum(body: string): number {
  let sum = 0;
  for (let i = 0; i < body.length; i++) sum ^= body.charCodeAt(i);
  return sum;
}

/** Formats a complete sentence with checksum, e.g. `withChecksum('GPGGA,...')` → `$GPGGA,...*hh`. */
export function withChecksum(body: string, lead: '$' | '!' = '$'): string {
  return `${lead}${body}*${nmeaChecksum(body).toString(16).toUpperCase().padStart(2, '0')}`;
}
