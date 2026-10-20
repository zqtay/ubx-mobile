import type { Constellation } from './types';

/**
 * Sub-satellite ("ground") points for the Map screen (REQ-MAP-12, technical spec §14.1a):
 * the point on Earth directly below a satellite, from the receiver position and the satellite's
 * azimuth and elevation, assuming a circular orbit of the constellation's radius.
 */

export const EARTH_RADIUS_KM = 6371;
const GEO_RADIUS_KM = 42_164;

/** BeiDou satellites in geostationary or inclined geosynchronous orbits (the rest are MEO). */
const BEIDOU_GEO_IGSO = new Set([
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 13, 16, 31, 38, 39, 40, 56, 59, 60, 61, 62, 63,
]);

/** Orbit radius from the Earth's centre in km, or undefined when unknown. */
export function orbitRadiusKm(constellation: Constellation, svid: number): number | undefined {
  switch (constellation) {
    case 'GPS':
      return 26_560;
    case 'GLONASS':
      return 25_510;
    case 'GALILEO':
      return 29_600;
    case 'BEIDOU':
      return BEIDOU_GEO_IGSO.has(svid) ? GEO_RADIUS_KM : 27_906;
    case 'QZSS':
    case 'NAVIC':
    case 'SBAS':
      return GEO_RADIUS_KM;
    default:
      return undefined;
  }
}

const RAD = Math.PI / 180;

/** Earth central angle (degrees) between the receiver and the sub-satellite point. */
export function centralAngleDeg(elevationDeg: number, orbitRadius: number): number {
  const e = elevationDeg * RAD;
  return (Math.PI / 2 - e - Math.asin((EARTH_RADIUS_KM * Math.cos(e)) / orbitRadius)) / RAD;
}

/** Point below the satellite seen at `azimuthDeg`/`elevationDeg` from `receiver`. */
export function subSatellitePoint(
  receiver: { lat: number; lon: number },
  azimuthDeg: number,
  elevationDeg: number,
  orbitRadius: number,
): { lat: number; lon: number } {
  const psi = centralAngleDeg(elevationDeg, orbitRadius) * RAD;
  const phi = receiver.lat * RAD;
  const az = azimuthDeg * RAD;
  const phi2 = Math.asin(
    Math.sin(phi) * Math.cos(psi) + Math.cos(phi) * Math.sin(psi) * Math.cos(az),
  );
  const dLon = Math.atan2(
    Math.sin(az) * Math.sin(psi) * Math.cos(phi),
    Math.cos(psi) - Math.sin(phi) * Math.sin(phi2),
  );
  const lon = ((((receiver.lon + dLon / RAD + 180) % 360) + 360) % 360) - 180;
  return { lat: phi2 / RAD, lon };
}
