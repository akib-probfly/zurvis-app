/**
 * Design tokens for the home-grown UI library (`src/ui`).
 *
 * Single source of truth for spacing, corner radii, type scale, and the
 * decorative icon-tile palette. Structural surfaces and text colors live in
 * `src/theme/colors.ts` so they can adapt to light/dark mode; everything here
 * is theme-independent.
 *
 * Rule of thumb: import from here instead of sprinkling magic numbers or
 * pasted hex values across screens. Prefer `gap` over margins and `padding`
 * over margins when laying out rows and cards.
 */

// Dense sizes retain existing compact layouts when migrating older screens.
export const spacing = {
  none: 0,
  hairline: 1,
  xxs: 2,
  tight: 3,
  xs: 4,
  compact: 6,
  sm: 8,
  control: 10,
  md: 12,
  inset: 14,
  lg: 16,
  roomy: 18,
  xl: 20,
  sectionInset: 22,
  xxl: 24,
  block: 28,
  xxxl: 32,
  huge: 40,
  section: 48,
} as const;

export type SpacingKey = keyof typeof spacing;

export const radius = {
  none: 0,
  xxs: 2,
  xs: 4,
  badge: 5,
  compact: 6,
  sm: 8,
  inset: 10,
  md: 12,
  chip: 13,
  lg: 14,
  control: 16,
  xl: 18,
  xxl: 20,
  panel: 22,
  xxxl: 24,
  dialog: 28,
  pill: 999,
} as const;

export type RadiusKey = keyof typeof radius;

export const fontSize = {
  micro: 8,
  badge: 9,
  tiny: 10,
  compact: 11,
  small: 12,
  caption: 13,
  section: 14,
  body: 15,
  subheading: 16,
  control: 17,
  heading: 18,
  lead: 19,
  sectionTitle: 20,
  headingLarge: 22,
  title: 24,
  display: 28,
  displaySmall: 30,
  displayLarge: 36,
  displayHero: 40,
  emoji: 44,
} as const;

export type FontSizeKey = keyof typeof fontSize;

export const fontWeight = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
  extrabold: '800',
} as const;

export type FontWeightKey = keyof typeof fontWeight;

/** Optional explicit line heights; apply when a layout needs predictable text rhythm. */
export const lineHeight = {
  tiny: 14,
  micro: 15,
  small: 16,
  compact: 17,
  caption: 18,
  control: 19,
  section: 20,
  subtitle: 21,
  body: 22,
  spacious: 23,
  subheading: 24,
  heading: 26,
  title: 32,
  display: 36,
  emoji: 52,
} as const;

export const letterSpacing = { tight: -0.6, normal: 0, wide: 0.4, overline: 0.8 } as const;

export const iconSize = { xs: 12, sm: 16, md: 20, lg: 24, xl: 32 } as const;

/** Visual control sizes. Compact controls can use hitSlop to expand their touch area. */
export const controlSize = { compact: 38, icon: 40, touchTarget: 44, input: 50, large: 56 } as const;

export const borderWidth = { none: 0, thin: 1, selected: 1.5, strong: 2 } as const;

/** Shared chip padding; compact is used by tag filters throughout the app. */
export const chipSize = {
  compact: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  default: { paddingHorizontal: 11, paddingVertical: 6 },
} as const;

export const opacity = { disabled: 0.6, pressed: 0.8, subtle: 0.4 } as const;

/** Animation durations in milliseconds; respect reduced-motion preferences at the call site. */
export const duration = { instant: 0, fast: 120, normal: 200, slow: 300 } as const;

/** Standard input height shared by text fields, search fields, and selects. */
export const inputHeight = controlSize.input;

/** Dense toolbar height (search fields, filter rows). */
export const inputHeightDense = controlSize.touchTarget;

/**
 * Decorative icon-tile palette used by settings rows, cards, and list items.
 * These are intentionally static across themes: pastel tiles stay legible on
 * both light and dark surfaces. Structural colors (backgrounds, text,
 * borders) must still come from `useTheme()` colors.
 */
export const iconTiles = {
  blue: { bg: '#eff6ff', fg: '#2563eb' },
  green: { bg: '#ecfdf5', fg: '#059669' },
  orange: { bg: '#fff7ed', fg: '#ea580c' },
  yellow: { bg: '#fefce8', fg: '#ca8a04' },
  pink: { bg: '#fdf2f8', fg: '#db2777' },
  indigo: { bg: '#eef2ff', fg: '#4f46e5' },
  slate: { bg: '#f1f5f9', fg: '#475569' },
  dark: { bg: '#1e293b', fg: '#f1f5f9' },
} as const;

export type IconTileKey = keyof typeof iconTiles;

/**
 * Shared card shadow using native shadow props and Android elevation.
 * Retained for consistent rendering with existing cards.
 */
export const cardShadow = {
  shadowColor: '#000',
  shadowOpacity: 0.06,
  shadowRadius: 8,
  shadowOffset: { width: 0, height: 2 },
  elevation: 2,
} as const;
