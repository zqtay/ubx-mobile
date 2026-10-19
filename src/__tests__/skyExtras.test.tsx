import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';
import * as Location from 'expo-location';

import { emptySnapshot, useGnssStore } from '@/state/gnssStore';
import { useSettings } from '@/state/settingsStore';
import {
  nextTrails,
  TRAIL_DURATION_MS,
  TRAIL_SAMPLE_MS,
  useSkyTrails,
} from '@/state/skyTrailStore';

import { demoSnapshot } from '../../test/helpers/demo';

jest.mock('expo-location', () => ({
  ...jest.requireActual('expo-location'),
  watchHeadingAsync: jest.fn(),
}));

jest.setTimeout(20_000);

const empty = { trails: new Map(), lastSampleMs: undefined, source: undefined };

describe('sky trails (REQ-SKY-10)', () => {
  it('samples every 10 s, drops old points and resets on a new source', () => {
    const snap = demoSnapshot();
    const hour = TRAIL_DURATION_MS['1h'];
    let s = nextTrails(empty, snap, 0, hour);
    const key = snap.satellites.find((x) => x.elevation !== undefined)!.key;
    expect(s.trails.get(key)?.points).toHaveLength(1);
    expect(nextTrails(s, snap, TRAIL_SAMPLE_MS - 1, hour)).toBe(s);
    s = nextTrails(s, snap, TRAIL_SAMPLE_MS, hour);
    expect(s.trails.get(key)?.points).toHaveLength(2);
    s = nextTrails(s, snap, hour + TRAIL_SAMPLE_MS + 1, hour);
    expect(s.trails.get(key)?.points.map((p) => p.atMs)).toEqual([hour + TRAIL_SAMPLE_MS + 1]);
    const fresh = nextTrails(s, { ...snap, source: 'android' }, 0, hour);
    expect([...fresh.trails.values()].every((tr) => tr.points.length === 1)).toBe(true);
    expect(nextTrails(s, snap, 0, 0).trails.size).toBe(0); // trails off
  });
});

describe('heading-up sky (REQ-SKY-09)', () => {
  beforeEach(() => {
    useSettings.getState().reset();
    useGnssStore.setState(emptySnapshot(), true);
  });

  it('rotates with the compass and draws trails when enabled', async () => {
    let send: (h: { trueHeading: number; magHeading: number; accuracy: number }) => void = () =>
      undefined;
    const remove = jest.fn();
    jest.mocked(Location.watchHeadingAsync).mockImplementation(async (cb) => {
      send = cb;
      return { remove };
    });
    useSettings.getState().update({ skyTrails: '1h' });
    useGnssStore.setState(demoSnapshot(), true);
    const trails = nextTrails(empty, demoSnapshot(), 0, TRAIL_DURATION_MS['1h']);
    const later = nextTrails(trails, demoSnapshot(), TRAIL_SAMPLE_MS, TRAIL_DURATION_MS['1h']);
    useSkyTrails.setState(later, true);

    await renderRouter('./src/app', { initialUrl: '/sky' });
    expect(screen.getAllByTestId(/^trail-/).length).toBeGreaterThan(0);

    await fireEvent.press(screen.getByRole('button', { name: 'Heading up (rotate with compass)' }));
    await act(async () => send({ trueHeading: 90, magHeading: 88, accuracy: 3 }));
    expect(screen.getByTestId('sky-heading').props.children).toBe('90°');
    await act(async () => send({ trueHeading: 91, magHeading: 89, accuracy: 3 })); // < 2°: ignored
    expect(screen.getByTestId('sky-heading').props.children).toBe('90°');

    await fireEvent.press(screen.getByRole('button', { name: 'North up' }));
    expect(remove).toHaveBeenCalled();
    expect(screen.queryByTestId('sky-heading')).toBeNull();
  });
});
