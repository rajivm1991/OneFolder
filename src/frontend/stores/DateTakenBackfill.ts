import fse from 'fs-extra';
import { promiseAllLimit } from '../../../common/promise';
import { firstExifDate, hasUtcDates } from '../../../common/exifDate';
import type ExifIO from '../../../common/ExifIO';
import { ClientFile } from '../entities/File';

const CONCURRENCY = 5;

async function diskModifiedDate(absolutePath: string): Promise<Date> {
  return (await fse.stat(absolutePath)).mtime;
}

/**
 * One-time backfill: for every file whose capture date hasn't been resolved yet (dateTaken === null),
 * reads DateTimeOriginal/CreateDate via ExifTool and stores the result. Files without an EXIF date
 * fall back to their modified date on disk, so every processed file ends up with a value and isn't
 * rechecked on the next run. Files that can't be read at all (e.g. missing) are left null and retried
 * next time. Writes go through ClientFile.setDateTaken, which feeds the existing debounced bulk-save
 * path on FileStore — no separate DB write here.
 */
export async function runDateTakenBackfill(
  files: ClientFile[],
  exifTool: ExifIO,
  getModifiedDate: (absolutePath: string) => Promise<Date> = diskModifiedDate,
): Promise<void> {
  const pending = files.filter((file) => file.dateTaken === null);

  const jobs = pending.map((file) => async () => {
    let exifDate: Date | null = null;
    try {
      const [original, created] = await exifTool.readExifTags(file.absolutePath, [
        'DateTimeOriginal',
        'CreateDate',
      ]);
      exifDate = firstExifDate([original, created], hasUtcDates(file.absolutePath));
    } catch (e) {
      console.warn('Date taken backfill: could not read EXIF dates for', file.absolutePath, e);
    }

    try {
      file.setDateTaken(exifDate ?? (await getModifiedDate(file.absolutePath)));
    } catch (e) {
      console.warn('Date taken backfill: could not resolve a date for', file.absolutePath, e);
    }
  });

  await promiseAllLimit(jobs, CONCURRENCY);
}
