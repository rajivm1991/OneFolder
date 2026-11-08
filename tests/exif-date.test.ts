import { firstExifDate, parseExifDate } from '../common/exifDate';

describe('parseExifDate', () => {
  it('parses a timezone-less value as local time', () => {
    expect(parseExifDate('2023:05:01 12:34:56')).toEqual(new Date(2023, 4, 1, 12, 34, 56));
  });

  it('honours Z and numeric offsets', () => {
    expect(parseExifDate('2023:05:01 12:34:56Z')).toEqual(new Date('2023-05-01T12:34:56Z'));
    expect(parseExifDate('2023:05:01 12:34:56+05:30')).toEqual(new Date('2023-05-01T07:04:56Z'));
    expect(parseExifDate('2023:05:01 12:34:56-0800')).toEqual(new Date('2023-05-01T20:34:56Z'));
  });

  it('ignores fractional seconds', () => {
    expect(parseExifDate('2023:05:01 12:34:56.78')).toEqual(new Date(2023, 4, 1, 12, 34, 56));
  });

  it('returns null for missing, zeroed or garbage values', () => {
    expect(parseExifDate(undefined)).toBeNull();
    expect(parseExifDate('')).toBeNull();
    expect(parseExifDate('   ')).toBeNull();
    expect(parseExifDate('0000:00:00 00:00:00')).toBeNull();
    expect(parseExifDate('2023:13:45 99:99:99')).toBeNull();
    expect(parseExifDate('yesterday')).toBeNull();
  });
});

describe('firstExifDate', () => {
  it('uses the first parsable value', () => {
    expect(firstExifDate(undefined, '0000:00:00 00:00:00', '2020:01:02 03:04:05')).toEqual(
      new Date(2020, 0, 2, 3, 4, 5),
    );
  });

  it('returns null when nothing parses', () => {
    expect(firstExifDate(undefined, 'nope')).toBeNull();
  });
});
