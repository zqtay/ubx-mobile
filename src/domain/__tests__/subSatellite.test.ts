import { centralAngleDeg, orbitRadiusKm, subSatellitePoint } from '@/domain/subSatellite';

describe('satellite ground points (REQ-MAP-12, technical spec §14.1a)', () => {
  it('uses the constellation orbit radius, with BeiDou GEO/IGSO apart from MEO', () => {
    expect(orbitRadiusKm('GPS', 5)).toBe(26_560);
    expect(orbitRadiusKm('BEIDOU', 3)).toBe(42_164); // GEO
    expect(orbitRadiusKm('BEIDOU', 38)).toBe(42_164); // IGSO
    expect(orbitRadiusKm('BEIDOU', 25)).toBe(27_906); // MEO
    expect(orbitRadiusKm('SBAS', 127)).toBe(42_164);
    expect(orbitRadiusKm('UNKNOWN', 1)).toBeUndefined();
  });

  it('puts a satellite at the zenith above the receiver and horizon satellites far away', () => {
    expect(centralAngleDeg(90, 26_560)).toBeCloseTo(0, 9);
    expect(centralAngleDeg(0, 26_560)).toBeCloseTo(76.11, 1); // GPS at the horizon
    expect(centralAngleDeg(0, 42_164)).toBeCloseTo(81.31, 1); // GEO at the horizon
    const here = { lat: 1.35, lon: 103.82 };
    const zenith = subSatellitePoint(here, 123, 90, 26_560);
    expect(zenith.lat).toBeCloseTo(here.lat, 6);
    expect(zenith.lon).toBeCloseTo(here.lon, 6);
  });

  it('moves along the azimuth on a great circle', () => {
    const psi = centralAngleDeg(30, 26_560);
    const north = subSatellitePoint({ lat: 0, lon: 0 }, 0, 30, 26_560);
    expect(north.lat).toBeCloseTo(psi, 6);
    expect(north.lon).toBeCloseTo(0, 6);
    const east = subSatellitePoint({ lat: 0, lon: 0 }, 90, 30, 26_560);
    expect(east.lat).toBeCloseTo(0, 6);
    expect(east.lon).toBeCloseTo(psi, 6);
    // Across the antimeridian the longitude wraps.
    const wrapped = subSatellitePoint({ lat: 0, lon: 170 }, 90, 30, 26_560);
    expect(wrapped.lon).toBeCloseTo(170 + psi - 360, 6);
  });
});
