import type { Fix } from '@/domain/types';

import { chipState, fixLabelKey, fixTone } from '../fixLabel';
import {
  DASH,
  formatClock,
  formatCoordinate,
  formatDegrees,
  formatDistance,
  formatDuration,
  formatLatLonPlain,
  formatLocalTime,
  formatNumber,
  formatSpeed,
  formatUtc,
} from '../format';
import { elevationRadius, nearestPoint, placeLabels, project } from '../sky/projection';
import { deviceReportText } from '../deviceSections';
import { shapePath } from '../sky/shapes';

describe('format (REQ-POS-03)', () => {
  it('formats coordinates in DD, DDM and DMS with hemispheres', () => {
    expect(formatCoordinate(1.3520833, 'lat')).toBe('1.3520833° N');
    expect(formatCoordinate(-33.5, 'lat', 'ddm')).toBe('33° 30.00000′ S');
    expect(formatCoordinate(-118.2575, 'lon', 'dms')).toBe('118° 15′ 27.000″ W');
    expect(formatCoordinate(103.8, 'lon', 'dms')).toMatch(/E$/);
    expect(formatCoordinate(undefined, 'lat')).toBe(DASH);
    expect(formatLatLonPlain(1.5, -2.25)).toBe('1.5000000, -2.2500000');
    expect(formatLatLonPlain(1.5, undefined)).toBeUndefined();
  });

  it('formats distances, speeds, angles and numbers in metric and imperial', () => {
    expect(formatDistance(32.44)).toBe('32.4 m');
    expect(formatDistance(10, 'imperial')).toBe('32.8 ft');
    expect(formatSpeed(1)).toBe('1.00 m/s');
    expect(formatSpeed(1, 'imperial')).toBe('2.24 mph');
    expect(formatDegrees(214.5, 1)).toBe('214.5°');
    expect(formatNumber(1.4234)).toBe('1.42');
    expect(formatSpeed(Number.NaN)).toBe(DASH);
    expect(formatDegrees(undefined)).toBe(DASH);
    expect(formatNumber(undefined)).toBe(DASH);
  });

  it('formats durations and times', () => {
    expect(formatDuration(28_400)).toBe('28.4 s');
    expect(formatDuration(125_000)).toBe('2 min 05 s');
    expect(formatDuration(undefined)).toBe(DASH);
    expect(formatUtc(Date.UTC(2026, 9, 18, 11, 39, 2))).toBe('2026-10-18 11:39:02.000');
    expect(formatUtc(Date.UTC(2026, 9, 18, 11, 39, 2), false)).toBe('11:39:02.000');
    expect(formatUtc(undefined)).toBe(DASH);
    expect(formatLocalTime(Date.UTC(2026, 9, 18, 11, 39, 2))).toMatch(
      /^\d{2}:\d{2}:\d{2} \(UTC[+-]\d+(:\d{2})?\)$/,
    );
    expect(formatLocalTime(undefined)).toBe(DASH);
    expect(formatClock(new Date(2026, 9, 18, 9, 5, 7).getTime())).toBe('09:05:07');
  });
});

describe('fix labels (functional spec §3.2) and status chip (REQ-SRC-03)', () => {
  const fix = (patch: Partial<Fix>): Fix => ({ fixType: '3d', receivedAtMs: 0, ...patch });

  it('classifies fixes', () => {
    expect(fixLabelKey(undefined)).toBe('none');
    expect(fixLabelKey(fix({ fixType: 'none' }))).toBe('none');
    expect(fixLabelKey(fix({ fixType: 'time-only' }))).toBe('timeOnly');
    expect(fixLabelKey(fix({ fixType: 'dead-reckoning' }))).toBe('dr');
    expect(fixLabelKey(fix({ fixType: '2d' }))).toBe('2d');
    expect(fixLabelKey(fix({ fixType: 'gnss-dr' }))).toBe('gnssDr');
    expect(fixLabelKey(fix({}))).toBe('3d');
    expect(fixLabelKey(fix({ differential: true }))).toBe('dgnss');
    expect(fixLabelKey(fix({ carrierSolution: 'float' }))).toBe('rtkFloat');
    expect(fixLabelKey(fix({ carrierSolution: 'fixed' }))).toBe('rtkFixed');
    expect(['none', 'timeOnly', '2d', '3d', 'rtkFixed'].map((k) => fixTone(k as never))).toEqual([
      'none',
      'weak',
      'weak',
      'good',
      'rtk',
    ]);
  });

  it('derives the chip state from source, connection and fix', () => {
    expect(chipState({ source: null, connection: { kind: 'idle' } })).toEqual({
      key: 'none',
      tone: 'idle',
    });
    expect(chipState({ source: 'usb', connection: { kind: 'connecting' } }).key).toBe('connecting');
    expect(chipState({ source: 'usb', connection: { kind: 'idle' } }).key).toBe('connecting');
    expect(chipState({ source: 'usb', connection: { kind: 'detecting' } }).key).toBe('detecting');
    expect(chipState({ source: 'usb', connection: { kind: 'waiting', sinceMs: 0 } }).tone).toBe(
      'warn',
    );
    expect(chipState({ source: 'usb', connection: { kind: 'disconnected', atMs: 0 } }).key).toBe(
      'disconnected',
    );
    expect(
      chipState({ source: 'usb', connection: { kind: 'error', code: 'E_IO', message: 'x' } }).tone,
    ).toBe('error');
    expect(
      chipState({ source: 'replay', connection: { kind: 'receiving' }, fix: fix({}) }),
    ).toEqual({
      key: 'fix',
      fixKey: '3d',
      tone: 'ok',
    });
    expect(chipState({ source: 'replay', connection: { kind: 'receiving' } }).tone).toBe('warn');
  });
});

describe('sky projection (functional spec §5.2)', () => {
  const R = 100;
  const c = { x: 100, y: 100 };

  it('maps zenith to the centre and the horizon to the rim, north up', () => {
    expect(project(90, 123, R, c)).toEqual(c);
    const north = project(0, 0, R, c);
    expect(north.x).toBeCloseTo(100);
    expect(north.y).toBeCloseTo(0);
    const east = project(45, 90, R, c);
    expect(east.x).toBeCloseTo(150);
    expect(east.y).toBeCloseTo(100);
    const south = project(0, 180, R, c);
    expect(south.y).toBeCloseTo(200);
    const west = project(0, 270, R, c);
    expect(west.x).toBeCloseTo(0);
    expect(elevationRadius(-5, R)).toBe(R);
    expect(project(30, 0, R).y).toBeCloseTo(100 - (R * 60) / 90);
  });

  it('rotates for heading-up mode', () => {
    // Facing east, an east satellite appears at the top.
    const p = project(0, 90, R, c, 90);
    expect(p.x).toBeCloseTo(100);
    expect(p.y).toBeCloseTo(0);
  });

  it('finds the nearest marker within the touch radius', () => {
    const pts = [
      { x: 10, y: 10 },
      { x: 50, y: 50 },
    ];
    expect(nearestPoint(pts, { x: 45, y: 52 }, 24)).toBe(1);
    expect(nearestPoint(pts, { x: 200, y: 200 }, 24)).toBeUndefined();
  });

  it('places labels without overlapping markers, other labels or the edge', () => {
    const markers = [
      { x: 50, y: 50 },
      { x: 50, y: 70 },
      { x: 2, y: 2 },
    ];
    const boxes = placeLabels(
      markers,
      [
        { width: 20, height: 10 },
        { width: 20, height: 10 },
        { width: 400, height: 10 },
      ],
      6,
      {
        width: 100,
        height: 100,
      },
    );
    expect(boxes[0]).toBeDefined();
    expect(boxes[1]).toBeDefined();
    expect(boxes[2]).toBeUndefined(); // too wide to fit anywhere
    const [a, b] = boxes as { x: number; y: number; width: number; height: number }[];
    const overlap =
      a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
    expect(overlap).toBe(false);
  });

  it('builds a path for every marker shape', () => {
    for (const shape of [
      'circle',
      'square',
      'triangle',
      'triangle-down',
      'pentagon',
      'hexagon',
      'diamond',
      'cross',
    ] as const) {
      expect(shapePath(shape, 10, 10, 5)).toMatch(/^M.*Z$/);
    }
  });
});

describe('device report (REQ-DEV-07)', () => {
  it('renders sections as plain text with dashes for missing values', () => {
    const text = deviceReportText(
      'UBX Mobile',
      [
        {
          title: 'Receiver',
          rows: [
            { label: 'Module', value: undefined },
            { label: 'Firmware', value: 'SPG 5.10' },
          ],
        },
      ],
      Date.UTC(2026, 9, 18, 12),
    );
    expect(text).toBe(
      [
        'UBX Mobile — 2026-10-18T12:00:00.000Z',
        '',
        'Receiver',
        '  Module: —',
        '  Firmware: SPG 5.10',
      ].join('\n'),
    );
  });
});
