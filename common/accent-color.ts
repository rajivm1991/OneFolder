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
  return luminance !== undefined && luminance > DARK_TEXT_LUMINANCE_THRESHOLD ? DARK_TEXT : LIGHT_TEXT;
}

/** WCAG contrast ratio (1 to 21) between two "#rrggbb" colours. Returns undefined if either is not a "#rrggbb" colour. */
export function contrastRatio(a: string, b: string): number | undefined {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  if (la === undefined || lb === undefined) {
    return undefined;
  }
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const MIN_FOREGROUND_CONTRAST = 4.5;

/**
 * The accent colour ("#rrggbb") to use as a foreground (text, links, icons) on top of the given background: the accent itself when it
 * has enough contrast, otherwise mixed towards black (light background) or white (dark background) until it does.
 * Returns the accent unchanged for anything that is not a "#rrggbb" colour.
 */
export function accentForegroundColor(
  accent: string,
  background: string,
  minContrast = MIN_FOREGROUND_CONTRAST,
): string {
  const bgLuminance = relativeLuminance(background);
  if (relativeLuminance(accent) === undefined || bgLuminance === undefined) {
    return accent;
  }
  const target = bgLuminance > 0.5 ? 0 : 255;
  const channels = [1, 3, 5].map((i) => parseInt(accent.slice(i, i + 2), 16));
  for (let step = 0; step <= 20; step++) {
    const t = step / 20;
    const color =
      '#' +
      channels
        .map((c) =>
          Math.round(c + (target - c) * t)
            .toString(16)
            .padStart(2, '0'),
        )
        .join('');
    if ((contrastRatio(color, background) ?? 0) >= minContrast) {
      return color;
    }
  }
  return target === 0 ? '#000000' : '#ffffff';
}
