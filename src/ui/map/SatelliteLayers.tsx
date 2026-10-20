import { Circle, G, Line, Path, Text as SvgText } from 'react-native-svg';

import { constellationMeta, svLabel, type SvLabelStyle } from '@/domain/constellations';
import { orbitRadiusKm, subSatellitePoint } from '@/domain/subSatellite';
import type { Satellite } from '@/domain/types';
import { project } from '@/ui/sky/projection';
import { shapePath } from '@/ui/sky/shapes';
import { cn0Color } from '@/ui/theme/cn0Scale';
import { useAppTheme } from '@/ui/theme/ThemeProvider';

import type { LatLon, Point } from './tiles';

/** Text with an outline in the background colour, readable over map tiles. */
function HaloText({
  x,
  y,
  size,
  weight,
  color,
  halo,
  children,
}: {
  x: number;
  y: number;
  size: number;
  weight: '600' | '700';
  color: string;
  halo: string;
  children: string;
}) {
  const common = { x, y, fontSize: size, fontWeight: weight, textAnchor: 'middle' as const };
  return (
    <>
      <SvgText {...common} fill={halo} stroke={halo} strokeWidth={3} strokeLinejoin="round">
        {children}
      </SvgText>
      <SvgText {...common} fill={color}>
        {children}
      </SvgText>
    </>
  );
}

interface MarkerProps {
  sat: Satellite;
  at: Point;
  r: number;
  label: string;
  /** Outline for satellites used in the fix (not colour alone). */
  usedStroke: string;
  textColor: string;
  haloColor: string;
}

function SatMarker({ sat, at, r, label, usedStroke, textColor, haloColor }: MarkerProps) {
  const used = sat.used === true;
  return (
    <G testID={`map-sat-${sat.key}`} opacity={used ? 1 : 0.75}>
      <Path
        d={shapePath(constellationMeta(sat.constellation).shape, at.x, at.y, r)}
        fill={cn0Color(sat.cn0)}
        stroke={used ? usedStroke : haloColor}
        strokeWidth={used ? 2 : 1}
      />
      <HaloText
        x={at.x}
        y={at.y + r + 11}
        size={11}
        weight="600"
        color={textColor}
        halo={haloColor}>
        {label}
      </HaloText>
    </G>
  );
}

/**
 * North-up sky plot centred on the receiver, over the map (REQ-MAP-11). Screen-sized: the
 * radius does not change with zoom.
 */
export function SkyOverlay({
  center,
  radius,
  satellites,
  labelStyle,
}: {
  center: Point;
  radius: number;
  satellites: readonly Satellite[];
  labelStyle: SvLabelStyle;
}) {
  const { colors, scheme } = useAppTheme();
  const ink = scheme === 'dark' ? '#FFFFFF' : '#111418';
  const halo = scheme === 'dark' ? '#111418' : '#FFFFFF';
  const ticks = [0, 90, 180, 270].map((az) => ({
    az,
    outer: project(0, az, radius, center),
    inner: project(0, az, radius - 10, center),
    label: project(0, az, radius + 12, center),
    text: ['N', 'E', 'S', 'W'][az / 90],
  }));
  return (
    <G testID="map-sky-overlay" pointerEvents="none">
      <Circle cx={center.x} cy={center.y} r={radius} fill={colors.surface} fillOpacity={0.35} />
      {[0, 30, 60].map((el) => (
        <Circle
          key={el}
          cx={center.x}
          cy={center.y}
          r={(radius * (90 - el)) / 90}
          fill="none"
          stroke={ink}
          strokeOpacity={el === 0 ? 0.7 : 0.4}
          strokeWidth={el === 0 ? 1.5 : 1}
        />
      ))}
      {ticks.map((t) => (
        <G key={t.az}>
          <Line
            x1={t.outer.x}
            y1={t.outer.y}
            x2={t.inner.x}
            y2={t.inner.y}
            stroke={ink}
            strokeWidth={1.5}
          />
          <HaloText x={t.label.x} y={t.label.y + 4} size={12} weight="700" color={ink} halo={halo}>
            {t.text}
          </HaloText>
        </G>
      ))}
      {satellites.map((s) => (
        <SatMarker
          key={s.key}
          sat={s}
          at={project(s.elevation!, s.azimuth!, radius, center)}
          r={8}
          label={svLabel(s.constellation, s.svid, labelStyle, s.glonassFcn)}
          usedStroke={ink}
          textColor={ink}
          haloColor={halo}
        />
      ))}
    </G>
  );
}

/** Ground points of satellites with a known orbit radius (REQ-MAP-12). */
export function groundPoints(
  receiver: LatLon,
  satellites: readonly Satellite[],
): { sat: Satellite; point: LatLon }[] {
  return satellites.flatMap((sat) => {
    const radius = orbitRadiusKm(sat.constellation, sat.svid);
    if (radius === undefined || sat.elevation === undefined || sat.azimuth === undefined) return [];
    return [{ sat, point: subSatellitePoint(receiver, sat.azimuth, sat.elevation, radius) }];
  });
}

/** Markers at the satellites' ground points. */
export function GroundPointsLayer({
  points,
  toScreen,
  labelStyle,
}: {
  points: readonly { sat: Satellite; point: LatLon }[];
  toScreen: (p: LatLon) => Point;
  labelStyle: SvLabelStyle;
}) {
  const { scheme } = useAppTheme();
  const ink = scheme === 'dark' ? '#FFFFFF' : '#111418';
  const halo = scheme === 'dark' ? '#111418' : '#FFFFFF';
  return (
    <G testID="map-ground-points" pointerEvents="none">
      {points.map(({ sat, point }) => (
        <SatMarker
          key={sat.key}
          sat={sat}
          at={toScreen(point)}
          r={6}
          label={svLabel(sat.constellation, sat.svid, labelStyle, sat.glonassFcn)}
          usedStroke={ink}
          textColor={ink}
          haloColor={halo}
        />
      ))}
    </G>
  );
}
