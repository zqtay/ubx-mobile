import { useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import {
  Image,
  StyleSheet,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
  type NativeTouchEvent,
} from 'react-native';
import Svg, { Circle, G, Line, Path, Polyline } from 'react-native-svg';

import type { TrackPoint } from '@/state/trackStore';
import { useAppTheme } from '@/ui/theme/ThemeProvider';

import {
  clampZoom,
  metersPerPixel,
  panBy,
  TILE_HEADERS,
  toScreen,
  visibleTiles,
  zoomAround,
  type LatLon,
  type Point,
} from './tiles';

export interface MapMarker extends LatLon {
  hAccM?: number;
  /** Shown as an arrow when defined. */
  courseDeg?: number;
  /** 'fix' = current position; 'last' = last known (no fix); 'stale' = source disconnected. */
  state: 'fix' | 'last' | 'stale';
}

export interface TileMapProps {
  center: LatLon;
  zoom: number;
  onViewChange: (center: LatLon, zoom: number) => void;
  /** Called once per pan, pinch or double tap (turns follow mode off). */
  onUserMove: () => void;
  marker?: MapMarker;
  track?: readonly TrackPoint[];
  /** Dim the tiles (dark theme). */
  dimTiles?: boolean;
  /** Whether any visible tile could be loaded (false = offline / server error). */
  onTilesAvailable?: (available: boolean) => void;
}

const MARKER_RADIUS = 8;
const DOUBLE_TAP_MS = 300;
const TAP_SLOP = 10;

interface Anchor {
  center: LatLon;
  zoom: number;
  touches: number;
  /** First touch (pan) or midpoint (pinch), page coordinates. */
  point: Point;
  distance: number;
  moved: boolean;
}

const touchList = (e: GestureResponderEvent): readonly NativeTouchEvent[] =>
  e.nativeEvent.touches ?? [];
const midpoint = (t: readonly NativeTouchEvent[]): Point =>
  t.length >= 2
    ? { x: (t[0].pageX + t[1].pageX) / 2, y: (t[0].pageY + t[1].pageY) / 2 }
    : { x: t[0]?.pageX ?? 0, y: t[0]?.pageY ?? 0 };
const spread = (t: readonly NativeTouchEvent[]) =>
  t.length >= 2 ? Math.hypot(t[0].pageX - t[1].pageX, t[0].pageY - t[1].pageY) : 0;

/**
 * OpenStreetMap raster map with position, accuracy and track overlay (technical spec §14).
 * Controlled: the parent owns `center` and `zoom`.
 */
export function TileMap({
  center,
  zoom,
  onViewChange,
  onUserMove,
  marker,
  track,
  dimTiles,
  onTilesAvailable,
}: TileMapProps) {
  const { colors } = useAppTheme();
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set());
  const [loaded, setLoaded] = useState<ReadonlySet<string>>(() => new Set());
  // After a failure, the next user move remounts the tiles so they are requested again.
  const [generation, setGeneration] = useState(0);

  const tiles = useMemo(
    () => (size.width > 0 ? visibleTiles(center, zoom, size.width, size.height) : []),
    [center, zoom, size.width, size.height],
  );
  const available = !(
    tiles.some((t) => failed.has(t.url)) && !tiles.some((t) => loaded.has(t.url))
  );
  useEffect(() => {
    onTilesAvailable?.(available);
  }, [available, onTilesAvailable]);

  const origin = useRef<Point>({ x: 0, y: 0 });
  const viewRef = useRef<ComponentRef<typeof View>>(null);
  const anchor = useRef<Anchor | null>(null);
  const lastTap = useRef<{ atMs: number; point: Point } | null>(null);

  // Gestures use the View's responder props directly (technical spec §14.3). Handlers read the
  // current props; the anchor records the view at the start of the gesture.
  const setAnchor = (e: GestureResponderEvent, moved: boolean) => {
    const t = touchList(e);
    anchor.current = {
      center,
      zoom,
      touches: t.length,
      point: midpoint(t),
      distance: spread(t),
      moved,
    };
  };
  /** Offset of a page point from the view centre. */
  const fromCentre = (p: Point): Point => ({
    x: p.x - origin.current.x - size.width / 2,
    y: p.y - origin.current.y - size.height / 2,
  });
  const userMoved = (a: Anchor) => {
    if (a.moved) return;
    a.moved = true;
    onUserMove();
    if (failed.size > 0) {
      setFailed(new Set());
      setGeneration((g) => g + 1);
    }
  };
  const onMove = (e: GestureResponderEvent) => {
    const a = anchor.current;
    const t = touchList(e);
    if (!a || t.length === 0) return;
    if (t.length !== a.touches) {
      setAnchor(e, a.moved);
      return;
    }
    const p = midpoint(t);
    const dx = p.x - a.point.x;
    const dy = p.y - a.point.y;
    if (t.length >= 2 && a.distance > 0) {
      const z = clampZoom(a.zoom + Math.log2(spread(t) / a.distance));
      const zoomed = zoomAround(a.center, a.zoom, z, fromCentre(a.point));
      userMoved(a);
      onViewChange(panBy(zoomed, z, dx, dy), z);
      return;
    }
    if (!a.moved && Math.hypot(dx, dy) < TAP_SLOP) return;
    userMoved(a);
    onViewChange(panBy(a.center, a.zoom, dx, dy), a.zoom);
  };
  const onRelease = (e: GestureResponderEvent) => {
    const a = anchor.current;
    anchor.current = null;
    if (!a || a.moved) return;
    const p = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY };
    const atMs = e.nativeEvent.timestamp;
    const prev = lastTap.current;
    if (
      prev &&
      atMs - prev.atMs < DOUBLE_TAP_MS &&
      Math.hypot(p.x - prev.point.x, p.y - prev.point.y) < TAP_SLOP * 2
    ) {
      lastTap.current = null;
      userMoved(a);
      const nz = clampZoom(Math.round(zoom) + 1);
      onViewChange(zoomAround(center, zoom, nz, fromCentre(p)), nz);
      return;
    }
    lastTap.current = { atMs, point: p };
  };

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize({ width, height });
    viewRef.current?.measureInWindow?.((x: number, y: number) => {
      origin.current = { x, y };
    });
  };

  const screen = (p: LatLon) => toScreen(p, center, zoom, size.width, size.height);
  const trackPoints = (track ?? [])
    .map((p) => screen(p))
    .map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(' ');
  const m = marker ? screen(marker) : undefined;
  const accuracyR =
    marker?.hAccM !== undefined ? marker.hAccM / metersPerPixel(marker.lat, zoom) : 0;
  const markerColor = marker?.state === 'stale' ? colors.textMuted : colors.primary;
  const gridStep = tiles[0]?.size ?? 256;
  const gridOffset = tiles[0] ? { x: tiles[0].left, y: tiles[0].top } : { x: 0, y: 0 };

  return (
    <View
      ref={viewRef}
      testID="tile-map"
      style={[styles.fill, { backgroundColor: colors.surfaceAlt }]}
      onLayout={onLayout}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderTerminationRequest={() => false}
      onResponderGrant={(e) => setAnchor(e, false)}
      onResponderMove={onMove}
      onResponderRelease={onRelease}>
      {size.width > 0 ? (
        <>
          <Svg width={size.width} height={size.height} style={StyleSheet.absoluteFill}>
            {/* Plain grid under the tiles: visible while loading or offline. */}
            {Array.from({ length: Math.ceil(size.width / gridStep) + 1 }, (_, i) => (
              <Line
                key={`v${i}`}
                x1={gridOffset.x + i * gridStep}
                x2={gridOffset.x + i * gridStep}
                y1={0}
                y2={size.height}
                stroke={colors.border}
              />
            ))}
            {Array.from({ length: Math.ceil(size.height / gridStep) + 1 }, (_, i) => (
              <Line
                key={`h${i}`}
                y1={gridOffset.y + i * gridStep}
                y2={gridOffset.y + i * gridStep}
                x1={0}
                x2={size.width}
                stroke={colors.border}
              />
            ))}
          </Svg>
          {tiles.map((t) => (
            <Image
              key={`${t.key}#${generation}`}
              testID={`map-tile-${t.z}-${t.x}-${t.y}`}
              source={{ uri: t.url, headers: TILE_HEADERS }}
              fadeDuration={0}
              onLoad={() => setLoaded((s) => (s.has(t.url) ? s : new Set(s).add(t.url)))}
              onError={() => setFailed((s) => (s.has(t.url) ? s : new Set(s).add(t.url)))}
              style={[
                styles.tile,
                {
                  left: Math.round(t.left),
                  top: Math.round(t.top),
                  width: Math.ceil(t.size) + 1,
                  height: Math.ceil(t.size) + 1,
                  opacity: dimTiles ? 0.8 : 1,
                },
              ]}
            />
          ))}
          <Svg
            width={size.width}
            height={size.height}
            style={StyleSheet.absoluteFill}
            pointerEvents="none">
            {trackPoints ? (
              <Polyline
                testID="map-track"
                points={trackPoints}
                fill="none"
                stroke={colors.primary}
                strokeOpacity={0.7}
                strokeWidth={3}
                strokeLinejoin="round"
              />
            ) : null}
            {m && accuracyR > MARKER_RADIUS ? (
              <Circle
                testID="map-accuracy"
                cx={m.x}
                cy={m.y}
                r={accuracyR}
                fill={markerColor}
                fillOpacity={0.15}
                stroke={markerColor}
                strokeOpacity={0.5}
              />
            ) : null}
            {m && marker?.courseDeg !== undefined ? (
              <G transform={`translate(${m.x} ${m.y}) rotate(${marker.courseDeg})`}>
                <Path testID="map-course" d="M0,-22 L7,-11 L-7,-11 Z" fill={markerColor} />
              </G>
            ) : null}
            {m ? (
              <Circle
                testID={`map-marker-${marker!.state}`}
                cx={m.x}
                cy={m.y}
                r={MARKER_RADIUS}
                fill={marker!.state === 'fix' ? markerColor : colors.surface}
                stroke={marker!.state === 'fix' ? '#FFFFFF' : markerColor}
                strokeWidth={3}
              />
            ) : null}
          </Svg>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
    overflow: 'hidden',
  },
  tile: {
    position: 'absolute',
  },
});
