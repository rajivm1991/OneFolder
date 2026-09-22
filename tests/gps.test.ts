import { parseGpsCoordinates } from '../common/gps';

describe('parseGpsCoordinates', () => {
  it('parses valid DMS-style EXIF GPS strings into decimal degrees', () => {
    const result = parseGpsCoordinates('48 deg 51\' 29.76" N', '2 deg 21\' 8.16" E');
    expect(result).not.toBeNull();
    expect(result!.lat).toBeCloseTo(48.8583, 3);
    expect(result!.lng).toBeCloseTo(2.3523, 3);
  });

  it('returns null when latitude is missing', () => {
    expect(parseGpsCoordinates(undefined, '2 deg 21\' 8.16" E')).toBeNull();
  });

  it('returns null when longitude is missing', () => {
    expect(parseGpsCoordinates('48 deg 51\' 29.76" N', undefined)).toBeNull();
  });

  it('returns null for a blank placeholder value (single space)', () => {
    expect(parseGpsCoordinates(' ', ' ')).toBeNull();
  });

  it('returns null when the underlying parser throws on garbage input', () => {
    expect(parseGpsCoordinates('not a coordinate', 'also not one')).toBeNull();
  });
});
