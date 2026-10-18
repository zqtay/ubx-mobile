/**
 * Sky plot geometry (functional spec §5.2): zenith at the centre, horizon at radius R,
 * north up (or rotated by `rotationDeg` in heading-up mode), azimuth clockwise.
 */
export interface Point {
  x: number;
  y: number;
}

const DEG = Math.PI / 180;

/** Radius for an elevation: linear in (90° − el). Negative elevations clamp to the horizon. */
export function elevationRadius(elevationDeg: number, radius: number): number {
  const el = Math.max(0, Math.min(90, elevationDeg));
  return (radius * (90 - el)) / 90;
}

export function project(
  elevationDeg: number,
  azimuthDeg: number,
  radius: number,
  center: Point = { x: radius, y: radius },
  rotationDeg = 0,
): Point {
  const r = elevationRadius(elevationDeg, radius);
  const a = (azimuthDeg - rotationDeg) * DEG;
  return { x: center.x + r * Math.sin(a), y: center.y - r * Math.cos(a) };
}

/** Index of the point nearest to `touch`, if within `maxDistance`. */
export function nearestPoint(
  points: readonly Point[],
  touch: Point,
  maxDistance: number,
): number | undefined {
  let best: number | undefined;
  let bestD = maxDistance * maxDistance;
  points.forEach((p, i) => {
    const d = (p.x - touch.x) ** 2 + (p.y - touch.y) ** 2;
    if (d <= bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

export interface LabelBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

const overlaps = (a: LabelBox, b: LabelBox) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/**
 * Greedy label placement (technical spec §8.1): try below, right, above, left of each marker and
 * keep the first box that stays inside the plot and does not collide with markers or earlier
 * labels. Returns undefined for labels that cannot be placed.
 */
export function placeLabels(
  markers: readonly Point[],
  labelSizes: readonly { width: number; height: number }[],
  markerRadius: number,
  bounds: { width: number; height: number },
): (LabelBox | undefined)[] {
  const gap = 2;
  const taken: LabelBox[] = markers.map((m) => ({
    x: m.x - markerRadius,
    y: m.y - markerRadius,
    width: markerRadius * 2,
    height: markerRadius * 2,
  }));
  return markers.map((m, i) => {
    const { width, height } = labelSizes[i];
    const candidates: LabelBox[] = [
      { x: m.x - width / 2, y: m.y + markerRadius + gap, width, height },
      { x: m.x + markerRadius + gap, y: m.y - height / 2, width, height },
      { x: m.x - width / 2, y: m.y - markerRadius - gap - height, width, height },
      { x: m.x - markerRadius - gap - width, y: m.y - height / 2, width, height },
    ];
    for (const box of candidates) {
      const inside =
        box.x >= 0 &&
        box.y >= 0 &&
        box.x + box.width <= bounds.width &&
        box.y + box.height <= bounds.height;
      if (!inside) continue;
      if (taken.some((t, j) => j !== i && overlaps(t, box))) continue;
      taken.push(box);
      return box;
    }
    return undefined;
  });
}
