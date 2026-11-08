// "2023:05:01 12:34:56", optionally with fractional seconds and a timezone ("Z", "+05:30", "-0800").
const EXIF_DATE = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?\s*(Z|[+-]\d{2}:?\d{2})?$/;

/**
 * QuickTime/MP4 dates (e.g. CreateDate) are stored in UTC, but ExifTool prints them without a zone
 * marker by default. Cameras write photo EXIF dates in local time, so only videos need this.
 * Keep in sync with ExifIO.isVideoFile.
 */
export function hasUtcDates(filepath: string): boolean {
  return /\.(mp4|webm|ogg)$/i.test(filepath);
}

/**
 * Parses an ExifTool date string (e.g. DateTimeOriginal, CreateDate) into a Date.
 * Values without a timezone are interpreted as local time, matching how cameras write them,
 * unless `assumeUtc` is set (see hasUtcDates).
 * Returns null for missing, blank, zeroed ("0000:00:00 00:00:00") or unparsable values.
 */
export function parseExifDate(raw: string | undefined | null, assumeUtc = false): Date | null {
  if (!raw) {
    return null;
  }
  const match = EXIF_DATE.exec(raw.trim());
  if (!match) {
    return null;
  }
  const [, year, month, day, hour, minute, second, zone] = match;
  const [y, mo, d, h, mi, s] = [year, month, day, hour, minute, second].map(Number);
  if (y === 0 || mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) {
    return null;
  }

  let date: Date;
  if (zone === undefined && !assumeUtc) {
    date = new Date(y, mo - 1, d, h, mi, s);
  } else if (zone === undefined || zone === 'Z') {
    date = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  } else {
    const sign = zone[0] === '-' ? -1 : 1;
    const digits = zone.slice(1).replace(':', '');
    const offsetMinutes = sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2)));
    date = new Date(Date.UTC(y, mo - 1, d, h, mi, s) - offsetMinutes * 60_000);
  }
  return isNaN(date.getTime()) ? null : date;
}

/** Picks the first parsable date out of several EXIF values (in priority order). */
export function firstExifDate(
  raws: (string | undefined | null)[],
  assumeUtc = false,
): Date | null {
  for (const raw of raws) {
    const parsed = parseExifDate(raw, assumeUtc);
    if (parsed) {
      return parsed;
    }
  }
  return null;
}
