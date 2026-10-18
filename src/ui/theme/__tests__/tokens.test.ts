import { contrastRatio } from '../contrast';
import { palettes, type ColorSchemeName } from '../tokens';

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
  ])('%s', (_name, fg, bg) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(AA);
  });
});
