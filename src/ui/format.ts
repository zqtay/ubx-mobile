import type { CoordinateFormat, UnitSystem } from '@/state/settingsStore';

/** Display formatting (functional spec §3, REQ-POS-03). All functions return '—' for missing values. */

export const DASH = '—';

const isNum = (v: number | undefined): v is number => v !== undefined && Number.isFinite(v);

export function formatCoordinate(
  value: number | undefined,
  axis: 'lat' | 'lon',
  format: CoordinateFormat = 'dd',
): string {
  if (!isNum(value)) return DASH;
  const hemi = axis === 'lat' ? (value >= 0 ? 'N' : 'S') : value >= 0 ? 'E' : 'W';
  const abs = Math.abs(value);
  if (format === 'dd') return `${abs.toFixed(7)}° ${hemi}`;
  const deg = Math.floor(abs);
  const minutes = (abs - deg) * 60;
  if (format === 'ddm') return `${deg}° ${minutes.toFixed(5)}′ ${hemi}`;
  const min = Math.floor(minutes);
  const sec = (minutes - min) * 60;
  return `${deg}° ${min}′ ${sec.toFixed(3)}″ ${hemi}`;
}

/** `lat, lon` in signed decimal degrees, for copying. */
export function formatLatLonPlain(
  lat: number | undefined,
  lon: number | undefined,
): string | undefined {
  if (!isNum(lat) || !isNum(lon)) return undefined;
  return `${lat.toFixed(7)}, ${lon.toFixed(7)}`;
}

export function formatDistance(
  meters: number | undefined,
  units: UnitSystem = 'metric',
  decimals = 1,
): string {
  if (!isNum(meters)) return DASH;
  return units === 'imperial'
    ? `${(meters * 3.28084).toFixed(decimals)} ft`
    : `${meters.toFixed(decimals)} m`;
}

export function formatSpeed(mps: number | undefined, units: UnitSystem = 'metric'): string {
  if (!isNum(mps)) return DASH;
  return units === 'imperial' ? `${(mps * 2.23694).toFixed(2)} mph` : `${mps.toFixed(2)} m/s`;
}

export function formatDegrees(value: number | undefined, decimals = 0): string {
  return isNum(value) ? `${value.toFixed(decimals)}°` : DASH;
}

export function formatNumber(value: number | undefined, decimals = 2): string {
  return isNum(value) ? value.toFixed(decimals) : DASH;
}

/** Durations such as TTFF: "28.4 s", "2 min 05 s". */
export function formatDuration(ms: number | undefined): string {
  if (!isNum(ms)) return DASH;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)} s`;
  const min = Math.floor(s / 60);
  return `${min} min ${String(Math.floor(s % 60)).padStart(2, '0')} s`;
}

/** UTC date/time "2026-10-18 11:39:02.000". */
export function formatUtc(epochMs: number | undefined, withDate = true): string {
  if (!isNum(epochMs)) return DASH;
  const iso = new Date(epochMs).toISOString(); // 2026-10-18T11:39:02.000Z
  return withDate ? `${iso.slice(0, 10)} ${iso.slice(11, 23)}` : iso.slice(11, 23);
}

/** Local time "19:39:02 (UTC+8)". */
export function formatLocalTime(epochMs: number | undefined): string {
  if (!isNum(epochMs)) return DASH;
  const d = new Date(epochMs);
  const pad = (n: number) => String(n).padStart(2, '0');
  const offsetMin = -d.getTimezoneOffset();
  const sign = offsetMin >= 0 ? '+' : '-';
  const oh = Math.floor(Math.abs(offsetMin) / 60);
  const om = Math.abs(offsetMin) % 60;
  const zone = `UTC${sign}${oh}${om ? `:${pad(om)}` : ''}`;
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} (${zone})`;
}

/** Wall-clock time "12:03:15" for "last data at" messages. */
export function formatClock(epochMs: number): string {
  const d = new Date(epochMs);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
