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
