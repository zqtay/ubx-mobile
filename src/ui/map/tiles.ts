import Constants from 'expo-constants';

/**
 * Web Mercator (EPSG:3857) and slippy-map tile maths for the Map screen (technical spec §14).
 * World pixels: at zoom z the world is 256·2^z pixels square, origin at 180° W / 85.05° N.
 */

export const TILE_SIZE = 256;
export const MIN_ZOOM = 2;
/** OSM standard tiles stop at 19 (tile usage policy). */
export const MAX_ZOOM = 19;
export const MAX_LAT = 85.05112878;

export const OSM_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
export const OSM_COPYRIGHT_URL = 'https://www.openstreetmap.org/copyright';

/** Identifies the app to the tile server, as the OSM tile usage policy requires. */
export const TILE_HEADERS = {
  'User-Agent': `UBXMobile/${Constants.expoConfig?.version ?? '0'} (Android; GNSS diagnostics)`,
};

export interface LatLon {
  lat: number;
  lon: number;
}

export interface Point {
  x: number;
  y: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function clampZoom(zoom: number): number {
  return clamp(zoom, MIN_ZOOM, MAX_ZOOM);
}

export function wrapLon(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

const worldSize = (zoom: number) => TILE_SIZE * 2 ** zoom;

/** World pixel coordinates of a position at a (possibly fractional) zoom. */
export function project({ lat, lon }: LatLon, zoom: number): Point {
  const size = worldSize(zoom);
  const sin = Math.sin((clamp(lat, -MAX_LAT, MAX_LAT) * Math.PI) / 180);
  return {
    x: ((lon + 180) / 360) * size,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size,
  };
}

export function unproject({ x, y }: Point, zoom: number): LatLon {
  const size = worldSize(zoom);
  const n = Math.PI - (2 * Math.PI * y) / size;
  return {
    lat: clamp((Math.atan(Math.sinh(n)) * 180) / Math.PI, -MAX_LAT, MAX_LAT),
    lon: wrapLon((x / size) * 360 - 180),
  };
}

/** Ground resolution in metres per screen pixel. */
export function metersPerPixel(lat: number, zoom: number): number {
  return (40075016.686 * Math.cos((lat * Math.PI) / 180)) / worldSize(zoom);
}

/** Screen position of `p` in a view of `width`×`height` centred on `center`. */
export function toScreen(
  p: LatLon,
  center: LatLon,
  zoom: number,
  width: number,
  height: number,
): Point {
  const a = project(p, zoom);
  const c = project(center, zoom);
  let dx = a.x - c.x;
  // Take the shorter way round the antimeridian.
  const size = worldSize(zoom);
  if (dx > size / 2) dx -= size;
  if (dx < -size / 2) dx += size;
  return { x: width / 2 + dx, y: height / 2 + (a.y - c.y) };
}

/** New centre after dragging the map content by (dx, dy) screen pixels. */
export function panBy(center: LatLon, zoom: number, dx: number, dy: number): LatLon {
  const c = project(center, zoom);
  return unproject({ x: c.x - dx, y: c.y - dy }, zoom);
}

/**
 * Zooms to `newZoom` keeping the point at `focus` (screen offset from the view centre) fixed.
 */
export function zoomAround(center: LatLon, zoom: number, newZoom: number, focus: Point): LatLon {
  const z = clampZoom(newZoom);
  const c = project(center, zoom);
  const target = unproject({ x: c.x + focus.x, y: c.y + focus.y }, zoom);
  const t = project(target, z);
  return unproject({ x: t.x - focus.x, y: t.y - focus.y }, z);
}

export interface TilePlacement {
  /** Unique per drawn tile (x is not wrapped, so repeated worlds get distinct keys). */
  key: string;
  url: string;
  z: number;
  x: number;
  y: number;
  left: number;
  top: number;
  size: number;
}

export function tileUrl(template: string, z: number, x: number, y: number): string {
  return template.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
}

/** Tiles covering a `width`×`height` view, loaded at the nearest integer zoom and scaled. */
export function visibleTiles(
  center: LatLon,
  zoom: number,
  width: number,
  height: number,
  template = OSM_TILE_URL,
): TilePlacement[] {
  const z = clamp(Math.round(zoom), 0, MAX_ZOOM);
  const size = TILE_SIZE * 2 ** (zoom - z);
  const c = project(center, zoom);
  const originX = c.x - width / 2;
  const originY = c.y - height / 2;
  const n = 2 ** z;
  const tiles: TilePlacement[] = [];
  const x0 = Math.floor(originX / size);
  const x1 = Math.floor((originX + width) / size);
  const y0 = Math.max(0, Math.floor(originY / size));
  const y1 = Math.min(n - 1, Math.floor((originY + height) / size));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const wx = ((x % n) + n) % n;
      tiles.push({
        key: `${z}/${x}/${y}`,
        url: tileUrl(template, z, wx, y),
        z,
        x: wx,
        y,
        left: x * size - originX,
        top: y * size - originY,
        size,
      });
    }
  }
  return tiles;
}
