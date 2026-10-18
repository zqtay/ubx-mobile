import { parseHex } from './contrast';
import { cn0NoSignal, cn0Stops } from './tokens';

function toHex(n: number): string {
  return Math.round(n).toString(16).padStart(2, '0').toUpperCase();
}

/**
 * Colour for a C/N0 value (functional spec §6.1): grey for no signal, then interpolated between
 * the scale stops and clamped at both ends.
 */
export function cn0Color(cn0: number | undefined): string {
  if (cn0 === undefined || !(cn0 > 0)) return cn0NoSignal;
  const first = cn0Stops[0];
  const last = cn0Stops[cn0Stops.length - 1];
  if (cn0 <= first.cn0) return first.color;
  if (cn0 >= last.cn0) return last.color;
  for (let i = 1; i < cn0Stops.length; i++) {
    const hi = cn0Stops[i];
    if (cn0 <= hi.cn0) {
      const lo = cn0Stops[i - 1];
      const t = (cn0 - lo.cn0) / (hi.cn0 - lo.cn0);
      const a = parseHex(lo.color);
      const b = parseHex(hi.color);
      return `#${toHex(a[0] + (b[0] - a[0]) * t)}${toHex(a[1] + (b[1] - a[1]) * t)}${toHex(a[2] + (b[2] - a[2]) * t)}`;
    }
  }
  return last.color;
}
