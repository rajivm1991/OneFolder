import { convert } from 'geo-coordinates-parser';

/**
 * Parses raw GPSLatitude/GPSLongitude EXIF string values (as returned by ExifTool,
 * e.g. `48 deg 51' 29.76" N`) into decimal degrees.
 * Returns null when either value is missing, blank, or unparsable.
 */
export function parseGpsCoordinates(
  rawLat: string | undefined,
  rawLng: string | undefined,
): { lat: number; lng: number } | null {
  if (!rawLat || rawLat === ' ' || !rawLng || rawLng === ' ') {
    return null;
  }

  try {
    const converted = convert(`${rawLat}, ${rawLng}`, 5);
    if (!converted) {
      return null;
    }
    return {
      lat: (converted as unknown as { decimalLatitude: number }).decimalLatitude,
      lng: (converted as unknown as { decimalLongitude: number }).decimalLongitude,
    };
  } catch {
    return null;
  }
}
