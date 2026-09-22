import { runGpsBackfill } from '../src/frontend/stores/GpsBackfill';
import type ExifIO from '../common/ExifIO';

describe('runGpsBackfill', () => {
  it('only reads files with lat === undefined, and applies parsed GPS via setGpsCoordinates', async () => {
    const readExifTags = jest.fn(async (path: string) => {
      if (path === '/has-gps.jpg') {
        return ["48 deg 51' 29.76\" N", "2 deg 21' 8.16\" E"];
      }
      return [undefined, undefined];
    });
    const exifTool = { readExifTags } as unknown as ExifIO;

    const setGpsCoordinates = jest.fn();
    const alreadyCheckedSet = jest.fn();
    const files = [
      { absolutePath: '/has-gps.jpg', lat: undefined, lng: undefined, setGpsCoordinates },
      { absolutePath: '/no-gps.jpg', lat: undefined, lng: undefined, setGpsCoordinates: alreadyCheckedSet },
      { absolutePath: '/skip-me.jpg', lat: 10, lng: 20, setGpsCoordinates: jest.fn() },
    ] as never;

    await runGpsBackfill(files, exifTool);

    expect(readExifTags).toHaveBeenCalledTimes(2); // only the two files with lat === undefined
    expect(readExifTags).toHaveBeenCalledWith('/has-gps.jpg', ['GPSLatitude', 'GPSLongitude']);

    const [lat, lng] = setGpsCoordinates.mock.calls[0];
    expect(lat).toBeCloseTo(48.858, 2);
    expect(lng).toBeCloseTo(2.352, 2);

    expect(alreadyCheckedSet).toHaveBeenCalledWith(null, null);
  });
});
