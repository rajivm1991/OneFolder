import { accentColorToCss, accentTextColor, relativeLuminance } from '../common/accent-color';

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
