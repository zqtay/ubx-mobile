import type { MarkerShape } from '@/domain/constellations';

/**
 * SVG path for a constellation marker (functional spec §6.2) centred on (cx, cy) with
 * circumradius r. Shapes, not colours, identify constellations.
 */
export function shapePath(shape: MarkerShape, cx: number, cy: number, r: number): string {
  const polygon = (sides: number, rotationDeg: number, scale = 1) => {
    const pts: string[] = [];
    for (let i = 0; i < sides; i++) {
      const a = ((rotationDeg + (360 / sides) * i) * Math.PI) / 180;
      pts.push(
        `${(cx + r * scale * Math.sin(a)).toFixed(2)},${(cy - r * scale * Math.cos(a)).toFixed(2)}`,
      );
    }
    return `M${pts.join('L')}Z`;
  };
  switch (shape) {
    case 'circle':
      return `M${cx - r},${cy}a${r},${r} 0 1,0 ${2 * r},0a${r},${r} 0 1,0 ${-2 * r},0Z`;
    case 'square': {
      const s = r * 0.85;
      return `M${cx - s},${cy - s}H${cx + s}V${cy + s}H${cx - s}Z`;
    }
    case 'triangle':
      return polygon(3, 0, 1.1);
    case 'triangle-down':
      return polygon(3, 180, 1.1);
    case 'pentagon':
      return polygon(5, 0);
    case 'hexagon':
      return polygon(6, 30);
    case 'diamond':
      return polygon(4, 0, 1.05);
    case 'cross': {
      const t = r * 0.35;
      return `M${cx - r},${cy - t}H${cx - t}V${cy - r}H${cx + t}V${cy - t}H${cx + r}V${cy + t}H${cx + t}V${cy + r}H${cx - t}V${cy + t}H${cx - r}Z`;
    }
  }
}
