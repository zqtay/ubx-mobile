import { cn0Color } from '../cn0Scale';
import { cn0NoSignal, cn0Stops } from '../tokens';

describe('cn0Color (functional spec §6.1)', () => {
  it('is grey for no signal', () => {
    expect(cn0Color(undefined)).toBe(cn0NoSignal);
    expect(cn0Color(0)).toBe(cn0NoSignal);
    expect(cn0Color(Number.NaN)).toBe(cn0NoSignal);
  });

  it('hits the stops exactly and clamps outside the range', () => {
    for (const stop of cn0Stops) expect(cn0Color(stop.cn0)).toBe(stop.color);
    expect(cn0Color(3)).toBe(cn0Stops[0].color);
    expect(cn0Color(60)).toBe(cn0Stops[cn0Stops.length - 1].color);
  });

  it('interpolates between stops', () => {
    // Halfway between #E53935 (20) and #FB8C00 (27).
    const mid = cn0Color(23.5);
    expect(mid).toMatch(/^#[0-9A-F]{6}$/);
    expect(mid).not.toBe(cn0Stops[1].color);
    expect(mid).not.toBe(cn0Stops[2].color);
    expect(mid).toBe('#F0631B');
  });
});
