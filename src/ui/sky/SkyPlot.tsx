import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable } from 'react-native';
import Svg, { Circle, G, Line, Path, Text as SvgText } from 'react-native-svg';

import { constellationMeta, svLabel, type SvLabelStyle } from '@/domain/constellations';
import type { Satellite } from '@/domain/types';
import { cn0Color } from '@/ui/theme/cn0Scale';
import { useAppTheme } from '@/ui/theme/ThemeProvider';

import { nearestPoint, placeLabels, project } from './projection';
import { shapePath } from './shapes';

export interface SkyPlotProps {
  /** Satellites with a known position above the horizon. */
  satellites: readonly Satellite[];
  size: number;
  labelStyle: SvLabelStyle;
  showLabels?: boolean;
  denseGrid?: boolean;
  /** Heading-up rotation in degrees (0 = north up). */
  rotationDeg?: number;
  onSelect?: (key: string) => void;
}

const MARGIN = 18;
const LABEL_HEIGHT = 12;
const TOUCH_RADIUS = 24;

/** Polar sky plot (functional spec §5.2–5.3). Zenith in the centre, horizon on the outer ring. */
export const SkyPlot = memo(function SkyPlot({
  satellites,
  size,
  labelStyle,
  showLabels = true,
  denseGrid = false,
  rotationDeg = 0,
  onSelect,
}: SkyPlotProps) {
  const { t } = useTranslation();
  const { colors, scheme } = useAppTheme();
  const center = size / 2;
  const R = center - MARGIN;
  const markerR = size < 300 ? 7 : 9;
  const usedStroke = scheme === 'dark' ? '#FFFFFF' : '#111418';

  const markers = useMemo(
    () =>
      satellites.map((s) => ({
        sat: s,
        point: project(s.elevation!, s.azimuth!, R, { x: center, y: center }, rotationDeg),
        label: svLabel(s.constellation, s.svid, labelStyle, s.glonassFcn),
      })),
    [satellites, R, center, rotationDeg, labelStyle],
  );

  const labels = useMemo(
    () =>
      showLabels
        ? placeLabels(
            markers.map((m) => m.point),
            markers.map((m) => ({ width: m.label.length * 6.6 + 2, height: LABEL_HEIGHT })),
            markerR,
            { width: size, height: size },
          )
        : [],
    [markers, showLabels, markerR, size],
  );

  const rings = denseGrid ? [0, 10, 20, 30, 40, 50, 60, 70, 80] : [0, 30, 60];
  const spokes = denseGrid ? Array.from({ length: 24 }, (_, i) => i * 15) : [0, 90, 180, 270];
  const cardinals = [
    { az: 0, text: 'N' },
    { az: 90, text: 'E' },
    { az: 180, text: 'S' },
    { az: 270, text: 'W' },
  ];

  const onPress = (x: number, y: number) => {
    const index = nearestPoint(
      markers.map((m) => m.point),
      { x, y },
      TOUCH_RADIUS,
    );
    if (index !== undefined) onSelect?.(markers[index].sat.key);
  };

  return (
    <Pressable
      testID="sky-plot"
      accessibilityLabel={t('sky.plotA11y', { count: satellites.length })}
      onPress={(e) => onPress(e.nativeEvent.locationX, e.nativeEvent.locationY)}>
      <Svg width={size} height={size}>
        <Circle
          cx={center}
          cy={center}
          r={R}
          fill={colors.skyBg}
          stroke={colors.grid}
          strokeWidth={2}
        />
        {rings.slice(1).map((el) => (
          <Circle
            key={el}
            cx={center}
            cy={center}
            r={(R * (90 - el)) / 90}
            fill="none"
            stroke={colors.grid}
            strokeWidth={0.75}
          />
        ))}
        {spokes.map((az) => {
          const p = project(0, az, R, { x: center, y: center }, rotationDeg);
          return (
            <Line
              key={az}
              x1={center}
              y1={center}
              x2={p.x}
              y2={p.y}
              stroke={colors.grid}
              strokeWidth={0.75}
            />
          );
        })}
        {denseGrid
          ? rings.slice(1).map((el) => (
              <SvgText
                key={`el${el}`}
                x={center + 3}
                y={center - (R * (90 - el)) / 90 + 10}
                fontSize={9}
                fill={colors.textMuted}>
                {`${el}°`}
              </SvgText>
            ))
          : null}
        {cardinals.map(({ az, text }) => {
          const p = project(0, az, R + 10, { x: center, y: center }, rotationDeg);
          return (
            <SvgText
              key={text}
              x={p.x}
              y={p.y + 4}
              fontSize={12}
              fontWeight="700"
              textAnchor="middle"
              fill={colors.text}>
              {text}
            </SvgText>
          );
        })}
        {markers.map(({ sat, point }) => {
          const used = sat.used === true;
          return (
            <G key={sat.key} opacity={used ? 1 : 0.6}>
              <Path
                d={shapePath(constellationMeta(sat.constellation).shape, point.x, point.y, markerR)}
                fill={cn0Color(sat.cn0)}
                stroke={used ? usedStroke : colors.grid}
                strokeWidth={used ? 2 : 1}
              />
              {sat.health === 'unhealthy' ? (
                <SvgText
                  x={point.x + markerR}
                  y={point.y - markerR + 2}
                  fontSize={11}
                  fontWeight="700"
                  fill={colors.warning}>
                  !
                </SvgText>
              ) : null}
            </G>
          );
        })}
        {labels.map((box, i) =>
          box ? (
            <SvgText
              key={markers[i].sat.key}
              x={box.x + box.width / 2}
              y={box.y + LABEL_HEIGHT - 2}
              fontSize={11}
              textAnchor="middle"
              fill={colors.text}>
              {markers[i].label}
            </SvgText>
          ) : null,
        )}
      </Svg>
    </Pressable>
  );
});
