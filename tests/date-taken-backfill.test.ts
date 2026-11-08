import { runDateTakenBackfill } from '../src/frontend/stores/DateTakenBackfill';
import type ExifIO from '../common/ExifIO';

describe('runDateTakenBackfill', () => {
  const mtime = new Date('2021-06-01T00:00:00Z');

  function makeFile(absolutePath: string, dateTaken: Date | null) {
    return { absolutePath, dateTaken, setDateTaken: jest.fn() };
  }

  it('only processes unresolved files, preferring the EXIF date over the disk date', async () => {
    const readExifTags = jest.fn(async (path: string) =>
      path === '/has-exif.jpg' ? ['2019:07:04 10:20:30', undefined] : [undefined, undefined],
    );
    const exifTool = { readExifTags } as unknown as ExifIO;
    const getModifiedDate = jest.fn(async () => mtime);

    const withExif = makeFile('/has-exif.jpg', null);
    const withoutExif = makeFile('/no-exif.png', null);
    const resolved = makeFile('/skip-me.jpg', new Date('2020-01-01'));

    await runDateTakenBackfill([withExif, withoutExif, resolved] as never, exifTool, getModifiedDate);

    expect(readExifTags).toHaveBeenCalledTimes(2);
    expect(readExifTags).toHaveBeenCalledWith('/has-exif.jpg', ['DateTimeOriginal', 'CreateDate']);
    expect(withExif.setDateTaken).toHaveBeenCalledWith(new Date(2019, 6, 4, 10, 20, 30));
    expect(withoutExif.setDateTaken).toHaveBeenCalledWith(mtime);
    expect(resolved.setDateTaken).not.toHaveBeenCalled();
  });

  it('falls back to the disk date when ExifTool throws', async () => {
    const exifTool = {
      readExifTags: jest.fn(async () => {
        throw new Error('boom');
      }),
    } as unknown as ExifIO;
    const file = makeFile('/broken-exif.jpg', null);

    await runDateTakenBackfill([file] as never, exifTool, async () => mtime);

    expect(file.setDateTaken).toHaveBeenCalledWith(mtime);
  });

  it('leaves the file unresolved when the disk date cannot be read either', async () => {
    const exifTool = { readExifTags: jest.fn(async () => [undefined, undefined]) } as unknown as ExifIO;
    const file = makeFile('/missing.jpg', null);

    await runDateTakenBackfill([file] as never, exifTool, async () => {
      throw new Error('ENOENT');
    });

    expect(file.setDateTaken).not.toHaveBeenCalled();
  });
});
