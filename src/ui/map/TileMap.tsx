import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentRef,
  type ReactNode,
} from 'react';
import {
  Animated,
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
  applyTransform,
  clampZoom,
  composeTransform,
  IDENTITY,
  MAX_ZOOM,
  metersPerPixel,
  MIN_ZOOM,
  TILE_HEADERS,
  TILE_SIZE,
  toScreen,
  visibleTiles,
  zoomAround,
  type LatLon,
  type Point,
  type ViewTransform,
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
  /** A gesture or double tap ended on this view. */
  onViewChange: (center: LatLon, zoom: number) => void;
  /**
   * Called once when a pan, pinch or double tap starts (turns follow mode off), with the view
   * shown at that moment.
   */
  onUserMove: (center: LatLon, zoom: number) => void;
  marker?: MapMarker;
  track?: readonly TrackPoint[];
  /** Dim the tiles (dark theme). */
  dimTiles?: boolean;
  /** Whether any visible tile could be loaded (false = offline / server error). */
  onTilesAvailable?: (available: boolean) => void;
  /** Extra overlay content (satellite layers), drawn under the position marker. */
  renderOverlay?: (
    toScreen: (p: LatLon) => Point,
    size: { width: number; height: number },
  ) => ReactNode;
}

const MARKER_RADIUS = 8;
const DOUBLE_TAP_MS = 300;
const TAP_SLOP = 10;
/** Tiles and overlays are drawn this far beyond the screen, so panning shows no blank edges. */
const MARGIN = TILE_SIZE;

interface Gesture {
  center: LatLon;
  zoom: number;
  /** Fingers in the current segment (a change starts a new segment). */
  touches: number;
  /** First touch (pan) or midpoint (pinch) at the start of the segment, page coordinates. */
  point: Point;
  distance: number;
  /** Transform at the start of the segment, and now. */
  base: ViewTransform;
  current: ViewTransform;
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
 *
 * Performance (technical spec §14.3): during a pan or pinch nothing re-renders; the gesture only
 * moves an animated transform of the already drawn tiles and overlays. The parent receives the
 * resulting view once, when the gesture ends.
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
  renderOverlay,
}: TileMapProps) {
  const { colors } = useAppTheme();
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set());
  const [loaded, setLoaded] = useState<ReadonlySet<string>>(() => new Set());
  // After a failure, the next user move remounts the tiles so they are requested again.
  const [generation, setGeneration] = useState(0);
  const [anim] = useState(() => ({
    x: new Animated.Value(0),
    y: new Animated.Value(0),
    scale: new Animated.Value(1),
  }));

  // Tiles for the screen plus a margin, positioned relative to the screen.
  const tiles = useMemo(
    () =>
      size.width > 0
        ? visibleTiles(center, zoom, size.width + 2 * MARGIN, size.height + 2 * MARGIN).map(
            (t) => ({ ...t, left: t.left - MARGIN, top: t.top - MARGIN }),
          )
        : [],
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
  const gesture = useRef<Gesture | null>(null);
  const lastTap = useRef<{ atMs: number; point: Point } | null>(null);
  const resetPending = useRef(false);

  // The parent re-rendered with the view a gesture ended on: drop the temporary transform.
  useLayoutEffect(() => {
    if (!resetPending.current) return;
    resetPending.current = false;
    anim.x.setValue(0);
    anim.y.setValue(0);
    anim.scale.setValue(1);
  });

  const show = (t: ViewTransform) => {
    anim.x.setValue(t.translate.x);
    anim.y.setValue(t.translate.y);
    anim.scale.setValue(t.scale);
  };

  /** Offset of a page point from the view centre. */
  const fromCentre = (p: Point): Point => ({
    x: p.x - origin.current.x - size.width / 2,
    y: p.y - origin.current.y - size.height / 2,
  });

  // Gestures use the View's responder props directly (technical spec §14.3).
  const startSegment = (e: GestureResponderEvent, prev: Gesture | null) => {
    const t = touchList(e);
    gesture.current = {
      center: prev?.center ?? center,
      zoom: prev?.zoom ?? zoom,
      touches: t.length,
      point: midpoint(t),
      distance: spread(t),
      base: prev?.current ?? IDENTITY,
      current: prev?.current ?? IDENTITY,
      moved: prev?.moved ?? false,
    };
  };
  const userMoved = (g: Gesture) => {
    if (g.moved) return;
    g.moved = true;
    onUserMove(g.center, g.zoom);
    if (failed.size > 0) {
      setFailed(new Set());
      setGeneration((n) => n + 1);
    }
  };
  const onMove = (e: GestureResponderEvent) => {
    const g = gesture.current;
    const t = touchList(e);
    if (!g || t.length === 0) return;
    if (t.length !== g.touches) {
      startSegment(e, g); // a finger was added or lifted: continue from the current transform
      return;
    }
    const p = midpoint(t);
    const pan = { x: p.x - g.point.x, y: p.y - g.point.y };
    let k = 1;
    if (t.length >= 2 && g.distance > 0) {
      // Keep the resulting zoom within the tile range.
      const total = g.base.scale * (spread(t) / g.distance);
      const limited = Math.min(2 ** (MAX_ZOOM - g.zoom), Math.max(2 ** (MIN_ZOOM - g.zoom), total));
      k = limited / g.base.scale;
    } else if (!g.moved && Math.hypot(pan.x, pan.y) < TAP_SLOP) {
      return;
    }
    userMoved(g);
    g.current = composeTransform(g.base, k, fromCentre(g.point), pan);
    show(g.current);
  };
  const onRelease = (e: GestureResponderEvent) => {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    if (g.moved) {
      // Commit once; the transform is dropped when the parent re-renders with this view.
      resetPending.current = true;
      const view = applyTransform(g.center, g.zoom, g.current);
      onViewChange(view.center, view.zoom);
      return;
    }
    const p = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY };
    const atMs = e.nativeEvent.timestamp;
    const prev = lastTap.current;
    if (
      prev &&
      atMs - prev.atMs < DOUBLE_TAP_MS &&
      Math.hypot(p.x - prev.point.x, p.y - prev.point.y) < TAP_SLOP * 2
    ) {
      lastTap.current = null;
      userMoved(g);
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
  const gridStep = tiles[0]?.size ?? TILE_SIZE;
  const gridOffset = tiles[0] ? { x: tiles[0].left, y: tiles[0].top } : { x: 0, y: 0 };
  const outer = { width: size.width + 2 * MARGIN, height: size.height + 2 * MARGIN };
  const shifted = `translate(${MARGIN} ${MARGIN})`;

  return (
    <View
      ref={viewRef}
      testID="tile-map"
      style={[styles.fill, { backgroundColor: colors.surfaceAlt }]}
      onLayout={onLayout}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderTerminationRequest={() => false}
      onResponderGrant={(e) => startSegment(e, null)}
      onResponderMove={onMove}
      onResponderRelease={onRelease}
      onResponderTerminate={onRelease}>
      {size.width > 0 ? (
        <Animated.View
          testID="tile-map-content"
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            {
              transform: [{ translateX: anim.x }, { translateY: anim.y }, { scale: anim.scale }],
            },
          ]}>
          <Svg
            width={outer.width}
            height={outer.height}
            style={[styles.outer, { left: -MARGIN, top: -MARGIN }]}>
            {/* Plain grid under the tiles: visible while loading or offline. */}
            <G transform={shifted}>
              {Array.from({ length: Math.ceil(outer.width / gridStep) + 1 }, (_, i) => (
                <Line
                  key={`v${i}`}
                  x1={gridOffset.x + i * gridStep}
                  x2={gridOffset.x + i * gridStep}
                  y1={-MARGIN}
                  y2={size.height + MARGIN}
                  stroke={colors.border}
                />
              ))}
              {Array.from({ length: Math.ceil(outer.height / gridStep) + 1 }, (_, i) => (
                <Line
                  key={`h${i}`}
                  y1={gridOffset.y + i * gridStep}
                  y2={gridOffset.y + i * gridStep}
                  x1={-MARGIN}
                  x2={size.width + MARGIN}
                  stroke={colors.border}
                />
              ))}
            </G>
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
            width={outer.width}
            height={outer.height}
            style={[styles.outer, { left: -MARGIN, top: -MARGIN }]}>
            <G transform={shifted}>
              {renderOverlay?.(screen, size)}
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
            </G>
          </Svg>
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
    overflow: 'hidden',
  },
  outer: {
    position: 'absolute',
  },
  tile: {
    position: 'absolute',
  },
});
