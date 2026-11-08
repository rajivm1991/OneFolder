/**
 * Turns the accent colour that Electron reports ("RRGGBBAA", without a "#") into a CSS colour ("#rrggbb").
 * The alpha channel is dropped. Returns undefined for anything that is not a colour.
 */
export function accentColorToCss(raw: string | undefined | null): string | undefined {
  if (typeof raw !== 'string') {
    return undefined;
  }
  const match = /^#?([0-9a-f]{6})(?:[0-9a-f]{2})?$/i.exec(raw.trim());
  return match ? `#${match[1].toLowerCase()}` : undefined;
}

/** WCAG relative luminance (0 = black, 1 = white) of a "#rrggbb" colour. Returns undefined for anything else. */
export function relativeLuminance(color: string): number | undefined {
  const match = /^#([0-9a-f]{6})$/i.exec(color);
  if (!match) {
    return undefined;
  }
  const [r, g, b] = [0, 2, 4].map((i) => {
    const channel = parseInt(match[1].slice(i, i + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const LIGHT_TEXT = '#ffffff';
const DARK_TEXT = '#1d1d1f';
// Above this luminance, white text has less than about 2.6:1 contrast. White stays on the macOS blue, purple, pink and
// graphite (luminance 0.24 to 0.28), which is the native look. Dark text goes on orange, yellow and green (0.43 and up).
const DARK_TEXT_LUMINANCE_THRESHOLD = 0.35;

/**
 * The text colour ("#rrggbb") to use on top of the given accent colour: dark above a luminance threshold, white otherwise.
 * Returns white for anything that is not a "#rrggbb" colour.
 */
export function accentTextColor(accent: string): string {
  const luminance = relativeLuminance(accent);
  return luminance !== undefined && luminance > DARK_TEXT_LUMINANCE_THRESHOLD ? DARK_TEXT : LIGHT_TEXT;
}
