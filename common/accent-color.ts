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

/**
 * Mixes a "#rgb" or "#rrggbb" colour towards white by the given amount (0 = unchanged, 1 = white) and returns "#rrggbb".
 * Returns undefined for anything that is not a hex colour.
 */
export function lightenColor(color: string, amount: number): string | undefined {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!match) {
    return undefined;
  }
  const hex = match[1].length === 3 ? match[1].replace(/./g, '$&$&') : match[1];
  const t = Math.min(1, Math.max(0, amount));
  return (
    '#' +
    [0, 2, 4]
      .map((i) => {
        const channel = parseInt(hex.slice(i, i + 2), 16);
        return Math.round(channel + (255 - channel) * t)
          .toString(16)
          .padStart(2, '0');
      })
      .join('')
  );
}

const LIGHT_TEXT = '#ffffff';
const DARK_TEXT = '#1d1d1f';
// A design choice, not a WCAG pass: white stays on the native macOS blue, purple, pink, red and graphite (luminance 0.24 to 0.28)
// to match the system look, even though white on those is only about 3.3:1 to 3.7:1 (below 4.5:1 for normal text). Above
// this luminance white falls below about 2.6:1 and becomes unreadable. Dark text goes on orange, yellow and green (0.43 and up).
const DARK_TEXT_LUMINANCE_THRESHOLD = 0.35;

/**
 * The text colour ("#rrggbb") to use on top of the given accent colour: dark above a luminance threshold, white otherwise.
 * Returns white for anything that is not a "#rrggbb" colour.
 */
export function accentTextColor(accent: string): string {
  const luminance = relativeLuminance(accent);
  return luminance !== undefined && luminance > DARK_TEXT_LUMINANCE_THRESHOLD
    ? DARK_TEXT
    : LIGHT_TEXT;
}
