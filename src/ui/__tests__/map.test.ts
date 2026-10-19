import {
  clampZoom,
  MAX_ZOOM,
  metersPerPixel,
  panBy,
  project,
  TILE_HEADERS,
  TILE_SIZE,
  toScreen,
  unproject,
  visibleTiles,
  wrapLon,
  zoomAround,
} from '@/ui/map/tiles';

const LONDON = { lat: 51.5074, lon: -0.1278 };

describe('Web Mercator tile maths (technical spec §14)', () => {
  it('finds the standard slippy-map tile of a position', () => {
    const p = project(LONDON, 10);
    expect([Math.floor(p.x / TILE_SIZE), Math.floor(p.y / TILE_SIZE)]).toEqual([511, 340]);
    expect(project({ lat: 0, lon: 0 }, 0)).toEqual({ x: 128, y: 128 });
  });

  it('round-trips, clamps latitude and wraps longitude', () => {
    const back = unproject(project(LONDON, 15.3), 15.3);
    expect(back.lat).toBeCloseTo(LONDON.lat, 9);
    expect(back.lon).toBeCloseTo(LONDON.lon, 9);
    expect(unproject(project({ lat: 89, lon: 0 }, 3), 3).lat).toBeCloseTo(85.0511, 3);
    expect(wrapLon(190)).toBe(-170);
    expect(wrapLon(-181)).toBe(179);
    expect(clampZoom(25)).toBe(MAX_ZOOM);
    expect(clampZoom(0)).toBe(2);
  });

  it('computes the ground resolution', () => {
    expect(metersPerPixel(0, 0)).toBeCloseTo(156543.03, 1);
    expect(metersPerPixel(60, 10)).toBeCloseTo(156543.03 / 1024 / 2, 1);
  });

  it('places the centre in the middle of the view and pans by pixels', () => {
    expect(toScreen(LONDON, LONDON, 16, 400, 600)).toEqual({ x: 200, y: 300 });
    const moved = panBy(LONDON, 16, 100, 0); // content dragged right → centre moves west
    expect(toScreen(LONDON, moved, 16, 400, 600).x).toBeCloseTo(300, 6);
    // Across the antimeridian the shorter way is used.
    expect(toScreen({ lat: 0, lon: 179.9 }, { lat: 0, lon: -179.9 }, 10, 400, 400).x).toBeLessThan(
      200,
    );
  });

  it('keeps the focal point fixed when zooming around it', () => {
    const focus = { x: 80, y: -40 };
    const c = project(LONDON, 14);
    const target = unproject({ x: c.x + focus.x, y: c.y + focus.y }, 14);
    const center = zoomAround(LONDON, 14, 15.5, focus);
    const s = toScreen(target, center, 15.5, 400, 400);
    expect(s.x).toBeCloseTo(280, 6);
    expect(s.y).toBeCloseTo(160, 6);
  });

  it('lists the visible tiles at the nearest zoom, scaled and wrapped', () => {
    const tiles = visibleTiles(LONDON, 10, 512, 512);
    expect(tiles.every((t) => t.z === 10 && t.size === 256)).toBe(true);
    expect(tiles.map((t) => t.url)).toContain('https://tile.openstreetmap.org/10/511/340.png');
    expect(tiles.length).toBeGreaterThanOrEqual(4);
    expect(tiles.length).toBeLessThanOrEqual(9);
    // Covering the view.
    expect(Math.min(...tiles.map((t) => t.left))).toBeLessThanOrEqual(0);
    expect(Math.max(...tiles.map((t) => t.left + t.size))).toBeGreaterThanOrEqual(512);

    const scaled = visibleTiles(LONDON, 10.4, 300, 300);
    expect(scaled[0].z).toBe(10);
    expect(scaled[0].size).toBeCloseTo(256 * 2 ** 0.4, 6);

    const world = visibleTiles({ lat: 0, lon: 179 }, 2, 1200, 600);
    expect(world.every((t) => t.x >= 0 && t.x < 4 && t.y >= 0 && t.y < 4)).toBe(true);
    expect(new Set(world.map((t) => t.key)).size).toBe(world.length);
  });

  it('identifies the app to the tile server (OSM tile usage policy)', () => {
    expect(TILE_HEADERS['User-Agent']).toMatch(/^UBXMobile\/\S+ \(Android/);
  });
});
