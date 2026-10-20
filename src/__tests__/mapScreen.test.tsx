import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';
import { Linking, StyleSheet } from 'react-native';

import { emptySnapshot, useGnssStore } from '@/state/gnssStore';
import { useSettings } from '@/state/settingsStore';
import { useTrack } from '@/state/trackStore';
import { project, TILE_HEADERS, TILE_SIZE } from '@/ui/map/tiles';

import { demoSnapshot } from '../../test/helpers/demo';

const APP = './src/app';
jest.setTimeout(20_000);

/** A responder event with the given touches (page coordinates), as PanResponder expects. */
function touchEvent(points: { x: number; y: number }[], timestamp: number) {
  const touches = points.map((p, i) => ({ identifier: i, pageX: p.x, pageY: p.y, timestamp }));
  return {
    nativeEvent: {
      touches,
      changedTouches: touches,
      pageX: points[0]?.x,
      pageY: points[0]?.y,
      timestamp,
    },
    touchHistory: {
      numberActiveTouches: points.length,
      indexOfSingleActiveTouch: 0,
      mostRecentTimeStamp: timestamp,
      touchBank: points.map((p) => ({
        touchActive: true,
        startPageX: p.x,
        startPageY: p.y,
        startTimeStamp: timestamp,
        currentPageX: p.x,
        currentPageY: p.y,
        currentTimeStamp: timestamp,
        previousPageX: p.x,
        previousPageY: p.y,
        previousTimeStamp: timestamp,
      })),
    },
  };
}

async function renderMap() {
  const router = await renderRouter(APP, { initialUrl: '/map' });
  const map = screen.getByTestId('tile-map');
  const layout = { nativeEvent: { layout: { x: 0, y: 0, width: 400, height: 600 } } };
  await act(async () => {
    fireEvent(map, 'layout', layout);
    fireEvent(screen.getByTestId('map-screen'), 'layout', layout);
  });
  return { router, map: () => screen.getByTestId('tile-map') };
}

const tileUrls = () => screen.getAllByTestId(/^map-tile-/).map((n) => n.props.source);

beforeEach(() => {
  useSettings.getState().reset();
  useGnssStore.setState(emptySnapshot(), true);
  useTrack.setState({ points: [], sessionKey: undefined }, true);
});

describe('Map screen (REQ-MAP, functional spec §12)', () => {
  it('shows the position on OpenStreetMap tiles with attribution (REQ-MAP-01, 04)', async () => {
    useGnssStore.setState(demoSnapshot(), true);
    await renderMap();
    const fix = useGnssStore.getState().fix!;
    expect(screen.getByText(/^1\.35208\d+° N 103\.81983\d+° E$/)).toBeTruthy(); // whitespace is normalised
    expect(screen.getByTestId('map-marker-fix')).toBeTruthy();

    const p = project({ lat: fix.lat!, lon: fix.lon! }, 16);
    const expected = `https://tile.openstreetmap.org/16/${Math.floor(p.x / TILE_SIZE)}/${Math.floor(p.y / TILE_SIZE)}.png`;
    const sources = tileUrls();
    expect(sources.map((s) => s.uri)).toContain(expected);
    expect(sources[0].headers).toEqual(TILE_HEADERS);

    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    await fireEvent.press(screen.getByRole('link'));
    expect(open).toHaveBeenCalledWith('https://www.openstreetmap.org/copyright');
    open.mockRestore();
  });

  it('zooms with the buttons and stops following when panned (REQ-MAP-02, 03)', async () => {
    useGnssStore.setState(demoSnapshot(), true);
    const { map } = await renderMap();
    await fireEvent.press(screen.getByRole('button', { name: 'Zoom in' }));
    expect(tileUrls().every((s) => s.uri.includes('/17/'))).toBe(true);
    await fireEvent.press(screen.getByRole('button', { name: 'Zoom out' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Zoom out' }));
    expect(tileUrls().every((s) => s.uri.includes('/15/'))).toBe(true);

    expect(screen.getByRole('button', { name: 'Following position' })).toBeTruthy();
    await act(async () => {
      map().props.onResponderGrant(touchEvent([{ x: 200, y: 300 }], 1));
      map().props.onResponderMove(touchEvent([{ x: 260, y: 300 }], 2));
      map().props.onResponderRelease(touchEvent([], 3));
    });
    expect(screen.getByRole('button', { name: 'Centre on position' })).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: 'Centre on position' }));
    expect(screen.getByRole('button', { name: 'Following position' })).toBeTruthy();
  });

  it('moves the drawn map during a drag and re-renders only when it ends (performance)', async () => {
    useGnssStore.setState(demoSnapshot(), true);
    const { map } = await renderMap();
    const before = tileUrls().map((t) => t.uri);
    await act(async () => {
      map().props.onResponderGrant(touchEvent([{ x: 200, y: 300 }], 1));
      map().props.onResponderMove(touchEvent([{ x: 500, y: 300 }], 2));
    });
    // Mid-gesture: same tiles, shifted by the transform.
    expect(tileUrls().map((t) => t.uri)).toEqual(before);
    const transform = StyleSheet.flatten(
      screen.getByTestId('tile-map-content').props.style,
    ).transform;
    expect(transform).toEqual([{ translateX: 300 }, { translateY: 0 }, { scale: 1 }]);
    await act(async () => {
      map().props.onResponderRelease(touchEvent([], 3));
    });
    // Released: the view moved by 300 px (new tiles) and the transform is back to identity.
    expect(tileUrls().map((t) => t.uri)).not.toEqual(before);
    expect(
      StyleSheet.flatten(screen.getByTestId('tile-map-content').props.style).transform,
    ).toEqual([{ translateX: 0 }, { translateY: 0 }, { scale: 1 }]);
  });

  it('zooms by pinching', async () => {
    useGnssStore.setState(demoSnapshot(), true);
    const { map } = await renderMap();
    await act(async () => {
      map().props.onResponderGrant(
        touchEvent(
          [
            { x: 150, y: 300 },
            { x: 250, y: 300 },
          ],
          1,
        ),
      );
      map().props.onResponderMove(
        touchEvent(
          [
            { x: 50, y: 300 },
            { x: 350, y: 300 },
          ],
          2,
        ),
      ); // ×3 ≈ +1.6
      map().props.onResponderRelease(touchEvent([], 3));
    });
    expect(tileUrls().every((s) => s.uri.includes('/18/'))).toBe(true);
  });

  it('waits for a fix, then shows the last position hollow (REQ-MAP-05)', async () => {
    const demo = demoSnapshot();
    useGnssStore.setState({ ...demo, fix: undefined }, true);
    await renderMap();
    expect(screen.getByText('Waiting for a position fix…')).toBeTruthy();
    expect(screen.queryByTestId('map-marker-fix')).toBeNull();
    expect(tileUrls().every((s) => s.uri.includes('/2/'))).toBe(true);

    await act(async () => {
      useGnssStore.setState(demo, true);
    });
    await act(async () => {
      useGnssStore.setState({ ...demo, fix: { ...demo.fix!, fixType: 'none' } }, true);
    });
    expect(screen.getByText('No fix — showing the last position')).toBeTruthy();
    expect(screen.getByTestId('map-marker-last')).toBeTruthy();
  });

  it('shows the sky overlay and ground points when toggled (REQ-MAP-11, 12)', async () => {
    useGnssStore.setState(demoSnapshot(), true);
    await renderMap();
    expect(screen.queryByTestId('map-sky-overlay')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: /^Sky overlay/ }));
    expect(useSettings.getState().mapSkyOverlay).toBe(true);
    expect(screen.getByTestId('map-sky-overlay')).toBeTruthy();
    expect(screen.getAllByTestId(/^map-sat-GPS:/).length).toBeGreaterThan(0);

    await fireEvent.press(screen.getByRole('button', { name: 'Satellite ground points' }));
    expect(useSettings.getState().mapGroundPoints).toBe(true);
    expect(screen.getByTestId('map-ground-points')).toBeTruthy();
    // At street zoom the ground points are thousands of km away.
    expect(screen.getByText("Zoom out to see the satellites' ground points.")).toBeTruthy();
    for (let i = 0; i < 14; i++) {
      await fireEvent.press(screen.getByRole('button', { name: 'Zoom out' }));
    }
    expect(screen.queryByText("Zoom out to see the satellites' ground points.")).toBeNull();

    await fireEvent.press(screen.getByRole('button', { name: /^Sky overlay/ }));
    expect(screen.queryByTestId('map-sky-overlay')).toBeNull();
  });

  it('reports unavailable tiles but keeps the position (REQ-MAP-06)', async () => {
    useGnssStore.setState(demoSnapshot(), true);
    await renderMap();
    const tiles = screen.getAllByTestId(/^map-tile-/);
    await act(async () => {
      for (const tile of tiles) tile.props.onError({ nativeEvent: { error: 'offline' } });
    });
    expect(screen.getByText('Map tiles unavailable — check the internet connection')).toBeTruthy();
    expect(screen.getByTestId('map-marker-fix')).toBeTruthy();
  });
});
