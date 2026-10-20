import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as Clipboard from 'expo-clipboard';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Pressable, StyleSheet, ToastAndroid, View } from 'react-native';

import { useGnssStore } from '@/state/gnssStore';
import { useSettings } from '@/state/settingsStore';
import { useTrack } from '@/state/trackStore';
import { AppText, Banner, DataGate } from '@/ui/components';
import { fixLabelKey } from '@/ui/fixLabel';
import { formatCoordinate, formatDistance, formatLatLonPlain } from '@/ui/format';
import { useSatelliteView } from '@/ui/hooks/useSatelliteView';
import { groundPoints, GroundPointsLayer, SkyOverlay } from '@/ui/map/SatelliteLayers';
import { TileMap, type MapMarker } from '@/ui/map/TileMap';
import { clampZoom, MIN_ZOOM, OSM_COPYRIGHT_URL, toScreen, type LatLon } from '@/ui/map/tiles';
import { hasSkyPosition } from '@/state/selectors';
import { useAppTheme } from '@/ui/theme/ThemeProvider';
import { minTouchTarget, radius, spacing } from '@/ui/theme/tokens';

export default function MapScreen() {
  const { t } = useTranslation();
  return (
    <DataGate icon="map-outline" placeholder={t('screens.map.placeholder')}>
      <MapContent />
    </DataGate>
  );
}

/** Zoom used when the map first centres on a position (functional spec §12.1). */
const POSITION_ZOOM = 16;
/** Course arrow only when moving (REQ-MAP-08). */
const MIN_COURSE_SPEED_MPS = 0.5;

/** Current position and track on OpenStreetMap (REQ-MAP, functional spec §12). */
function MapContent() {
  const { t } = useTranslation();
  const { colors, scheme } = useAppTheme();
  const fix = useGnssStore((s) => s.fix);
  const stale = useGnssStore((s) => s.stale);
  const track = useTrack((s) => s.points);
  const coordinateFormat = useSettings((s) => s.coordinateFormat);
  const units = useSettings((s) => s.units);

  const hasFix =
    fix?.lat !== undefined &&
    fix.lon !== undefined &&
    fix.fixType !== 'none' &&
    fix.fixType !== 'time-only';
  const last = track.at(-1);
  const marker: MapMarker | undefined = hasFix
    ? {
        lat: fix.lat!,
        lon: fix.lon!,
        hAccM: fix.hAccM,
        courseDeg:
          (fix.speedMps ?? 0) > MIN_COURSE_SPEED_MPS && fix.courseDeg !== undefined
            ? fix.courseDeg
            : undefined,
        state: stale ? 'stale' : 'fix',
      }
    : last
      ? { lat: last.lat, lon: last.lon, state: stale ? 'stale' : 'last' }
      : undefined;

  const [follow, setFollow] = useState(true);
  // `zoom` undefined = not chosen by the user yet: world view until a position is known.
  const [view, setView] = useState<{ center: LatLon; zoom: number | undefined }>({
    center: { lat: 0, lon: 0 },
    zoom: undefined,
  });
  const [tilesAvailable, setTilesAvailable] = useState(true);
  const [mapSize, setMapSize] = useState({ width: 0, height: 0 });

  // Satellite layers (REQ-MAP-11, 12), with the same filter as the Satellites and Sky screens.
  const skyOverlay = useSettings((s) => s.mapSkyOverlay);
  const showGround = useSettings((s) => s.mapGroundPoints);
  const update = useSettings((s) => s.update);
  const { filtered, labelStyle } = useSatelliteView();
  const placed = useMemo(() => filtered.filter(hasSkyPosition), [filtered]);
  const ground = useMemo(
    () => (showGround && marker ? groundPoints(marker, placed) : []),
    [showGround, marker?.lat, marker?.lon, placed], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const zoom = view.zoom ?? (marker ? POSITION_ZOOM : MIN_ZOOM);
  const center = follow && marker ? { lat: marker.lat, lon: marker.lon } : view.center;
  const groundVisible = ground.some(({ point }) => {
    const s = toScreen(point, center, zoom, mapSize.width, mapSize.height);
    return s.x >= 0 && s.y >= 0 && s.x <= mapSize.width && s.y <= mapSize.height;
  });

  const onViewChange = useCallback((c: LatLon, z: number) => setView({ center: c, zoom: z }), []);
  const onUserMove = useCallback(() => setFollow(false), []);
  const zoomBy = (delta: number) => setView({ center, zoom: clampZoom(Math.round(zoom) + delta) });
  const centreOnPosition = () => {
    setFollow(true);
    if (view.zoom !== undefined && view.zoom < 10) setView({ center, zoom: POSITION_ZOOM });
  };

  const copy = async () => {
    const text = formatLatLonPlain(marker?.lat, marker?.lon);
    if (!text) return;
    await Clipboard.setStringAsync(text);
    ToastAndroid.show(t('map.copied'), ToastAndroid.SHORT);
  };

  return (
    <View
      testID="map-screen"
      style={styles.fill}
      onLayout={(e) => setMapSize(e.nativeEvent.layout)}>
      <TileMap
        center={center}
        zoom={zoom}
        onViewChange={onViewChange}
        onUserMove={onUserMove}
        marker={marker}
        track={track}
        dimTiles={scheme === 'dark'}
        onTilesAvailable={setTilesAvailable}
        renderOverlay={(project, size) => (
          <>
            {ground.length > 0 ? (
              <GroundPointsLayer points={ground} toScreen={project} labelStyle={labelStyle} />
            ) : null}
            {skyOverlay && marker ? (
              <SkyOverlay
                center={project(marker)}
                radius={Math.min(size.width, size.height) * 0.4}
                satellites={placed}
                labelStyle={labelStyle}
              />
            ) : null}
          </>
        )}
      />

      <View style={styles.top} pointerEvents="box-none">
        <Pressable
          testID="map-position"
          onLongPress={() => void copy()}
          accessibilityHint={t('map.copyHint')}
          style={[styles.overlay, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {hasFix ? (
            <>
              <AppText variant="mono">
                {`${formatCoordinate(fix.lat, 'lat', coordinateFormat)}  ${formatCoordinate(fix.lon, 'lon', coordinateFormat)}`}
              </AppText>
              <AppText variant="caption" muted>
                {[
                  fix.hAccM !== undefined ? `±${formatDistance(fix.hAccM, units)}` : undefined,
                  t(`fix.${fixLabelKey(fix)}`),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </AppText>
            </>
          ) : (
            <AppText variant="label">
              {marker ? t('map.lastPosition') : t('map.waitingFix')}
            </AppText>
          )}
        </Pressable>
        {!tilesAvailable ? <Banner tone="warning" message={t('map.tilesUnavailable')} /> : null}
        {showGround && ground.length > 0 && !groundVisible ? (
          <Banner tone="info" message={t('map.groundHint')} />
        ) : null}
      </View>

      <View style={styles.controls} pointerEvents="box-none">
        <MapButton
          icon="radar"
          label={t('map.skyOverlay')}
          selected={skyOverlay}
          onPress={() => update({ mapSkyOverlay: !skyOverlay })}
        />
        <MapButton
          icon="earth"
          label={t('map.groundPoints')}
          selected={showGround}
          onPress={() => update({ mapGroundPoints: !showGround })}
        />
        <MapButton icon="plus" label={t('map.zoomIn')} onPress={() => zoomBy(1)} />
        <MapButton icon="minus" label={t('map.zoomOut')} onPress={() => zoomBy(-1)} />
        <MapButton
          icon={follow && marker ? 'crosshairs-gps' : 'crosshairs'}
          label={follow ? t('map.following') : t('map.centre')}
          selected={follow}
          disabled={!marker}
          onPress={centreOnPosition}
        />
      </View>

      <Pressable
        accessibilityRole="link"
        accessibilityLabel={t('map.openCopyright')}
        onPress={() => void Linking.openURL(OSM_COPYRIGHT_URL)}
        style={[styles.attribution, { backgroundColor: colors.surface }]}>
        <AppText variant="caption">{t('map.attribution')}</AppText>
      </Pressable>
    </View>
  );
}

function MapButton({
  icon,
  label,
  onPress,
  selected,
  disabled,
}: {
  icon: 'plus' | 'minus' | 'crosshairs-gps' | 'crosshairs' | 'radar' | 'earth';
  label: string;
  onPress: () => void;
  selected?: boolean;
  disabled?: boolean;
}) {
  const { colors } = useAppTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: !!selected, disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          opacity: disabled ? 0.5 : pressed ? 0.75 : 1,
        },
      ]}>
      <MaterialCommunityIcons
        name={icon}
        size={24}
        color={selected ? colors.primary : colors.text}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  top: {
    position: 'absolute',
    top: spacing.md,
    left: spacing.md,
    right: spacing.md,
    gap: spacing.sm,
  },
  overlay: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 2,
  },
  controls: {
    position: 'absolute',
    right: spacing.md,
    bottom: spacing.xl + spacing.md,
    gap: spacing.sm,
  },
  button: {
    width: minTouchTarget,
    height: minTouchTarget,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 2,
  },
  attribution: {
    position: 'absolute',
    left: 0,
    bottom: 0,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderTopRightRadius: radius.sm,
    opacity: 0.85,
  },
});
