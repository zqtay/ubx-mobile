import { contrastRatio } from '../contrast';
import { palettes, switchColors, type ColorSchemeName } from '../tokens';

const AA = 4.5;
const schemes: ColorSchemeName[] = ['light', 'dark'];

describe('contrastRatio', () => {
  it('matches the WCAG reference values', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrastRatio('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5);
  });
});

describe.each(schemes)('%s palette meets WCAG AA (REQ-NFR-07)', (scheme) => {
  const c = palettes[scheme];

  it.each([
    ['text on bg', c.text, c.bg],
    ['text on surface', c.text, c.surface],
    ['text on surfaceAlt', c.text, c.surfaceAlt],
    ['textMuted on bg', c.textMuted, c.bg],
    ['textMuted on surface', c.textMuted, c.surface],
    ['textMuted on surfaceAlt', c.textMuted, c.surfaceAlt],
    ['onPrimary on primary', c.onPrimary, c.primary],
    ['primary on surface', c.primary, c.surface],
    ['info on infoBg', c.info, c.infoBg],
    ['success on successBg', c.success, c.successBg],
    ['warning on warningBg', c.warning, c.warningBg],
    ['danger on dangerBg', c.danger, c.dangerBg],
    ['text on infoBg', c.text, c.infoBg],
    ['text on warningBg', c.text, c.warningBg],
    ['text on dangerBg', c.text, c.dangerBg],
    // Used satellite rows are tinted with infoBg and may show muted captions.
    ['textMuted on infoBg', c.textMuted, c.infoBg],
    ['primary on bg', c.primary, c.bg],
    // M6 screens: unsaved badges, Console rows, wide-table Y/N cells, staged values.
    ['warning on surface (unsaved badge)', c.warning, c.surface],
    ['warning on bg (unsaved count)', c.warning, c.bg],
    ['primary on surfaceAlt (Console UBX detail)', c.primary, c.surfaceAlt],
    ['danger on bg (Console errors)', c.danger, c.bg],
    ['success on bg (wide table Y)', c.success, c.bg],
    ['danger on infoBg (wide table N, used row)', c.danger, c.infoBg],
    ['success on infoBg (wide table Y, used row)', c.success, c.infoBg],
    ['primary on infoBg', c.primary, c.infoBg],
  ])('%s', (_name, fg, bg) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(AA);
  });
});

describe('switchColors (technical spec §8.3)', () => {
  it.each<ColorSchemeName>(['light', 'dark'])(
    'uses theme colours for the thumb, visible on the card (%s)',
    (scheme) => {
      const c = palettes[scheme];
      const on = switchColors(c, true);
      const off = switchColors(c, false);
      expect(on.thumbColor).toBe(c.primary);
      expect(on.trackColor.true).toBe(`${c.primary}80`);
      expect(off.thumbColor).toBe(c.textMuted);
      // Non-text contrast (WCAG 1.4.11): the thumb overhangs the track, so 3:1 against the card.
      expect(contrastRatio(on.thumbColor, c.surface)).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(off.thumbColor, c.surface)).toBeGreaterThanOrEqual(3);
      expect(switchColors(c, true, true).style).toEqual({ opacity: 0.5 });
      expect(on.style).toBeUndefined();
    },
  );
});
