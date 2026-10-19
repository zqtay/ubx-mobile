import { act, renderRouter, screen } from 'expo-router/testing-library';

import { interpretUbx } from '@/protocols/ubx/interpreter';
import { GnssAccumulator } from '@/state/GnssAccumulator';
import { emptySnapshot, useGnssStore } from '@/state/gnssStore';
import { useSettings } from '@/state/settingsStore';

import { navPvt, navTimeLs } from '../../test/helpers/fixtures';

jest.setTimeout(20_000);

const payload = (frame: Uint8Array) => frame.subarray(6, frame.length - 2);

describe('u-blox extras on the Status screen (REQ-POS-02)', () => {
  beforeEach(() => {
    useSettings.getState().reset();
    useGnssStore.setState(emptySnapshot(), true);
  });

  it('decodes leap seconds from NAV-TIMELS', () => {
    expect(interpretUbx(0x01, 0x26, payload(navTimeLs(18)), 0)).toEqual([
      { t: 'fix', origin: 'ubx', fix: { leapSeconds: 18, leapSecondsValid: true } },
    ]);
    expect(interpretUbx(0x01, 0x26, new Uint8Array(4), 0)).toEqual([]);
  });

  it('shows differential, fix-OK, time validity and leap seconds', async () => {
    const acc = new GnssAccumulator({ satelliteTimeoutMs: 60_000, now: () => 0 });
    acc.start('usb');
    acc.applyAll([
      { t: 'connection', state: { kind: 'receiving' } },
      ...interpretUbx(0x01, 0x07, payload(navPvt({ numSV: 9 })), 0),
      ...interpretUbx(0x01, 0x26, payload(navTimeLs(18, false)), 0),
    ]);
    await renderRouter('./src/app', { initialUrl: '/status' });
    await act(async () => useGnssStore.setState(acc.snapshot(), true));
    expect(screen.getByLabelText(/^Fix within accuracy masks: Yes/)).toBeTruthy();
    expect(screen.getByLabelText(/^Differential corrections: /)).toBeTruthy();
    expect(screen.getByLabelText(/^Validity: Date valid · Time valid/)).toBeTruthy();
    expect(
      screen.getByLabelText('Leap seconds (GPS−UTC): 18 s (default, not yet received)'),
    ).toBeTruthy();
  });
});
