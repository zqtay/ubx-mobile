/**
 * Semantic design tokens (technical spec §8.3). Components must use these
 * tokens rather than literal colours so light/dark themes stay consistent.
 */

export type ColorSchemeName = 'light' | 'dark';

export interface Palette {
  /** Screen background. */
  bg: string;
  /** Cards, sheets, header. */
  surface: string;
  /** Subtle fills inside surfaces (chips, bar tracks). */
  surfaceAlt: string;
  border: string;
  text: string;
  textMuted: string;
  /** Brand / interactive accent. */
  primary: string;
  /** Text and icons drawn on `primary`. */
  onPrimary: string;
  /** Sky-plot grid lines. */
  grid: string;
  /** Sky-plot background. */
  skyBg: string;
  success: string;
  warning: string;
  danger: string;
  info: string;
  /** Background tints for banners, paired with the colours above. */
  successBg: string;
  warningBg: string;
  dangerBg: string;
  infoBg: string;
  fix: {
    none: string;
    weak: string;
    good: string;
    rtk: string;
  };
  /** Constellation identity colours (badges, chips, trails) — not C/N0. */
  gnss: {
    gps: string;
    glo: string;
    gal: string;
    bds: string;
    qzss: string;
    navic: string;
    sbas: string;
    other: string;
  };
}

/**
 * Constellation colours are based on the Okabe–Ito palette, which stays
 * distinguishable for common colour-vision deficiencies. Shape remains the
 * primary cue (functional spec §6.2).
 */
const gnssLight: Palette['gnss'] = {
  gps: '#0072B2',
  glo: '#D55E00',
  gal: '#009E73',
  bds: '#CC79A7',
  qzss: '#E69F00',
  navic: '#56B4E9',
  sbas: '#7F7F7F',
  other: '#999999',
};

const gnssDark: Palette['gnss'] = {
  ...gnssLight,
  gps: '#3D9BE0',
  sbas: '#9E9E9E',
  other: '#B0B0B0',
};

export const palettes: Record<ColorSchemeName, Palette> = {
  light: {
    bg: '#F3F4F6',
    surface: '#FFFFFF',
    surfaceAlt: '#ECEEF1',
    border: '#D7DBE0',
    text: '#111418',
    textMuted: '#555C69',
    primary: '#1F4E8C',
    onPrimary: '#FFFFFF',
    grid: '#9AA1AC',
    skyBg: '#FFFFFF',
    success: '#2E7D32',
    warning: '#8A5300',
    danger: '#C62828',
    info: '#1565C0',
    successBg: '#E6F4E7',
    warningBg: '#FFF3DC',
    dangerBg: '#FDE8E8',
    infoBg: '#E5F0FC',
    fix: { none: '#9E3A3A', weak: '#B26A00', good: '#2E7D32', rtk: '#1565C0' },
    gnss: gnssLight,
  },
  dark: {
    bg: '#0B0D10',
    surface: '#16191E',
    surfaceAlt: '#20242B',
    border: '#2C313A',
    text: '#E8EAED',
    textMuted: '#A3AAB6',
    primary: '#8AB4F8',
    onPrimary: '#0B0D10',
    grid: '#5A616C',
    skyBg: '#050607',
    success: '#81C784',
    warning: '#FFB74D',
    danger: '#EF9A9A',
    info: '#90CAF9',
    successBg: '#1B2E1C',
    warningBg: '#33270F',
    dangerBg: '#3A1C1C',
    infoBg: '#14263B',
    fix: { none: '#E57373', weak: '#FFB74D', good: '#81C784', rtk: '#90CAF9' },
    gnss: gnssDark,
  },
};

/**
 * C/N0 colour scale stops in dB-Hz (functional spec §6.1). Shared by the
 * satellite list, sky markers, gauge and chart. Identical in both themes.
 */
export const cn0Stops: readonly { cn0: number; color: string }[] = [
  { cn0: 10, color: '#B71C1C' },
  { cn0: 20, color: '#E53935' },
  { cn0: 27, color: '#FB8C00' },
  { cn0: 35, color: '#FDD835' },
  { cn0: 45, color: '#43A047' },
];

/** Colour for "no signal". */
export const cn0NoSignal = '#9E9E9E';

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 6,
  md: 10,
  lg: 16,
  pill: 999,
} as const;

export const typography = {
  title: { fontSize: 20, lineHeight: 26, fontWeight: '600' },
  heading: { fontSize: 16, lineHeight: 22, fontWeight: '600' },
  body: { fontSize: 15, lineHeight: 21, fontWeight: '400' },
  label: { fontSize: 14, lineHeight: 20, fontWeight: '500' },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '400' },
  mono: { fontSize: 14, lineHeight: 20, fontWeight: '400', fontFamily: 'monospace' },
} as const;

export type TypographyVariant = keyof typeof typography;

/** Minimum touch target (requirements REQ-NFR-02). */
export const minTouchTarget = 48;
