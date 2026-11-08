import {
  accentColorToCss,
  accentForegroundColor,
  accentTextColor,
  contrastRatio,
  lightenColor,
  relativeLuminance,
} from '../common/accent-color';

describe('relativeLuminance', () => {
  it('is 0 for black and 1 for white', () => {
    expect(relativeLuminance('#000000')).toBe(0);
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 5);
  });

  it('rejects anything that is not #rrggbb', () => {
    expect(relativeLuminance('ffffff')).toBeUndefined();
    expect(relativeLuminance('#fff')).toBeUndefined();
    expect(relativeLuminance('')).toBeUndefined();
  });
});

describe('accentTextColor', () => {
  it('uses dark text on the light macOS accent colours', () => {
    expect(accentTextColor('#ffcc00')).toBe('#1d1d1f'); // yellow
    expect(accentTextColor('#ff9500')).toBe('#1d1d1f'); // orange
    expect(accentTextColor('#30d158')).toBe('#1d1d1f'); // green
  });

  it('uses white text on the dark macOS accent colours', () => {
    expect(accentTextColor('#0a84ff')).toBe('#ffffff'); // blue
    expect(accentTextColor('#8e8e93')).toBe('#ffffff'); // graphite
    expect(accentTextColor('#bf5af2')).toBe('#ffffff'); // purple
  });

  it('falls back to white for anything that is not a colour', () => {
    expect(accentTextColor('blue')).toBe('#ffffff');
  });
});

describe('accentForegroundColor', () => {
  const LIGHT_BG = '#f0f0f0';
  const DARK_BG = '#1c1e23';

  it('keeps an accent that already has enough contrast', () => {
    expect(accentForegroundColor('#000000', LIGHT_BG)).toBe('#000000');
    expect(accentForegroundColor('#ffffff', DARK_BG)).toBe('#ffffff');
  });

  it('keeps a mid-tone accent that already has enough contrast', () => {
    expect(contrastRatio('#1d4ed8', LIGHT_BG)).toBeGreaterThanOrEqual(4.5);
    expect(accentForegroundColor('#1d4ed8', LIGHT_BG)).toBe('#1d4ed8');
  });

  it('darkens a near-white accent on a light background', () => {
    const fg = accentForegroundColor('#fafafa', LIGHT_BG);
    expect(fg).not.toBe('#fafafa');
    expect(contrastRatio(fg, LIGHT_BG)).toBeGreaterThanOrEqual(4.5);
  });

  it('darkens light accents on a light background until they are readable', () => {
    for (const accent of ['#ffcc00', '#ff9500', '#30d158', '#0a84ff']) {
      const fg = accentForegroundColor(accent, LIGHT_BG);
      expect(contrastRatio(fg, LIGHT_BG)).toBeGreaterThanOrEqual(4.5);
      expect(relativeLuminance(fg)!).toBeLessThan(relativeLuminance(accent)!);
    }
  });

  it('lightens dark accents on a dark background until they are readable', () => {
    for (const accent of ['#8e8e93', '#bf5af2', '#000000']) {
      const fg = accentForegroundColor(accent, DARK_BG);
      expect(contrastRatio(fg, DARK_BG)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('returns the accent unchanged for anything that is not a colour', () => {
    expect(accentForegroundColor('blue', LIGHT_BG)).toBe('blue');
    expect(accentForegroundColor('#ffcc00', 'white')).toBe('#ffcc00');
  });
});

describe('contrastRatio', () => {
  it('is 21 for black on white and 1 for identical colours', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#336699', '#336699')).toBeCloseTo(1, 5);
  });
});

describe('lightenColor', () => {
  it('mixes towards white', () => {
    expect(lightenColor('#000000', 0)).toBe('#000000');
    expect(lightenColor('#000000', 1)).toBe('#ffffff');
    expect(lightenColor('#000000', 0.5)).toBe('#808080');
  });

  it('expands short hex and clamps the amount', () => {
    expect(lightenColor('#888', 0)).toBe('#888888');
    expect(lightenColor('#0a84ff', 2)).toBe('#ffffff');
    expect(lightenColor('#0a84ff', -1)).toBe('#0a84ff');
  });

  it('rejects anything that is not a hex colour', () => {
    expect(lightenColor('blue', 0.5)).toBeUndefined();
    expect(lightenColor('rgb(1, 2, 3)', 0.5)).toBeUndefined();
    expect(lightenColor('', 0.5)).toBeUndefined();
  });
});

describe('accentColorToCss', () => {
  it('drops the alpha channel and adds the hash', () => {
    expect(accentColorToCss('0A84FFFF')).toBe('#0a84ff');
    expect(accentColorToCss('ff9500cc')).toBe('#ff9500');
  });

  it('accepts a colour that already has a hash or no alpha', () => {
    expect(accentColorToCss('#007AFF')).toBe('#007aff');
    expect(accentColorToCss('007AFF')).toBe('#007aff');
  });

  it('rejects anything else', () => {
    expect(accentColorToCss(undefined)).toBeUndefined();
    expect(accentColorToCss('')).toBeUndefined();
    expect(accentColorToCss('blue')).toBeUndefined();
    expect(accentColorToCss('12345')).toBeUndefined();
  });
});
