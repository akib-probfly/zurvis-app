import type { ThemeColors } from './colors';

/** Share one stylesheet per palette, including across repeated list rows. */
export function createThemedStyles<T>(factory: (colors: ThemeColors) => T) {
  const cache = new WeakMap<ThemeColors, T>();
  return (colors: ThemeColors): T => {
    const existing = cache.get(colors);
    if (existing !== undefined) return existing;
    const styles = factory(colors);
    cache.set(colors, styles);
    return styles;
  };
}
