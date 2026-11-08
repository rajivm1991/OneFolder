import { accentColorToCss } from '../common/accent-color';

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
