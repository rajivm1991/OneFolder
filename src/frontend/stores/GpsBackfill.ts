import { promiseAllLimit } from '../../../common/promise';
import { parseGpsCoordinates } from '../../../common/gps';
import type ExifIO from '../../../common/ExifIO';
import { ClientFile } from '../entities/File';

const CONCURRENCY = 5;

/**
 * One-time backfill: for every file where GPS hasn't been checked yet (lat === undefined),
 * reads GPSLatitude/GPSLongitude via ExifTool and stores the result.
 * Files with GPS get real coordinates; files without get lat/lng set to null so they're
 * not rechecked on the next run. Writes go through ClientFile.setGpsCoordinates, which
 * feeds the existing debounced bulk-save path on FileStore — no separate DB write here.
 */
export async function runGpsBackfill(files: ClientFile[], exifTool: ExifIO): Promise<void> {
  const pending = files.filter((file) => file.lat === undefined);

  const jobs = pending.map((file) => async () => {
    try {
      const [rawLat, rawLng] = await exifTool.readExifTags(file.absolutePath, [
        'GPSLatitude',
        'GPSLongitude',
      ]);
      const parsed = parseGpsCoordinates(rawLat, rawLng);
      file.setGpsCoordinates(parsed?.lat ?? null, parsed?.lng ?? null);
    } catch (e) {
      console.warn('GPS backfill: could not read GPS data for', file.absolutePath, e);
      file.setGpsCoordinates(null, null);
    }
  });

  await promiseAllLimit(jobs, CONCURRENCY);
}
