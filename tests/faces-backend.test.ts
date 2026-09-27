import { OrderDirection } from '../src/api/data-storage-search';
import { FaceDetectionStatusDTO, FaceDTO } from '../src/api/face';
import { FileDTO } from '../src/api/file';
import Backend from '../src/backend/backend';
import { dbInit } from '../src/backend/config';

describe('Backend face detection API', () => {
  let TEST_DATABASE_ID_COUNTER = 0;

  function test(name: string, testFn: (backend: Backend) => Promise<void>) {
    it(name, async () => {
      const db = dbInit(`Test_Faces_${TEST_DATABASE_ID_COUNTER++}`);
      const backend = await Backend.init(db, () => {});
      await testFn(backend);
    });
  }

  function mockFace(overrides: Partial<FaceDTO> = {}): FaceDTO {
    return {
      id: 'face-1',
      fileId: 'file-1',
      boundingBox: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
      descriptor: new Array(128).fill(0).map((_, i) => i * 0.01),
      personId: null,
      dateDetected: new Date('2026-09-27T00:00:00.000Z'),
      ...overrides,
    };
  }

  function mockStatus(overrides: Partial<FaceDetectionStatusDTO> = {}): FaceDetectionStatusDTO {
    return {
      fileId: 'file-1',
      status: 'done',
      dateDetected: new Date('2026-09-27T00:00:00.000Z'),
      ...overrides,
    };
  }

  function mockFile(id: string, locationId: string): FileDTO {
    return {
      id,
      absolutePath: `/loc-${locationId}/${id}.jpg`,
      relativePath: `${id}.jpg`,
      locationId,
      name: `${id}.jpg`,
      size: 42,
      width: 640,
      height: 480,
      dateAdded: new Date(),
      dateModified: new Date(),
      dateCreated: new Date(),
      dateLastIndexed: new Date(),
      extension: 'jpg',
      ino: id,
      tags: [],
      annotations: '',
      lat: undefined,
      lng: undefined,
    };
  }

  test('saveFaceDetectionResult then fetchFacesForFile round-trips a face', async (backend) => {
    const face = mockFace();
    await backend.saveFaceDetectionResult(mockStatus(), [face]);
    const faces = await backend.fetchFacesForFile('file-1');
    expect(faces).toHaveLength(1);
    expect(faces[0]).toEqual(face);
  });

  test('fetchFacesForFile returns empty array for a file with no faces', async (backend) => {
    expect(await backend.fetchFacesForFile('nonexistent-file')).toEqual([]);
  });

  test('stores multiple faces for the same file (crowd photo)', async (backend) => {
    await backend.saveFaceDetectionResult(mockStatus(), [
      mockFace({ id: 'face-1' }),
      mockFace({ id: 'face-2', boundingBox: { x: 0.5, y: 0, width: 0.2, height: 0.2 } }),
    ]);
    const faces = await backend.fetchFacesForFile('file-1');
    expect(faces.map((f) => f.id).sort()).toEqual(['face-1', 'face-2']);
  });

  test('a 0-face result still records a status, so the file counts as processed', async (backend) => {
    await backend.saveFaceDetectionResult(mockStatus({ fileId: 'no-faces' }), []);
    expect(await backend.fetchFacesForFile('no-faces')).toEqual([]);
    expect(await backend.fetchFaceDetectionStatuses(['no-faces'])).toEqual([
      mockStatus({ fileId: 'no-faces' }),
    ]);
  });

  test('a failed attempt is recorded with status "failed"', async (backend) => {
    await backend.saveFaceDetectionResult(mockStatus({ fileId: 'bad', status: 'failed' }), []);
    const [status] = await backend.fetchFaceDetectionStatuses(['bad']);
    expect(status.status).toBe('failed');
  });

  test('fetchFaceDetectionStatuses omits files never attempted', async (backend) => {
    await backend.saveFaceDetectionResult(mockStatus({ fileId: 'a' }), []);
    const statuses = await backend.fetchFaceDetectionStatuses(['a', 'never-attempted']);
    expect(statuses.map((s) => s.fileId)).toEqual(['a']);
  });

  test('re-detecting a file replaces its stale faces and updates its status', async (backend) => {
    await backend.saveFaceDetectionResult(mockStatus(), [
      mockFace({ id: 'old-1' }),
      mockFace({ id: 'old-2' }),
    ]);
    const later = new Date('2026-09-28T00:00:00.000Z');
    await backend.saveFaceDetectionResult(mockStatus({ dateDetected: later }), [
      mockFace({ id: 'new-1', dateDetected: later }),
    ]);
    const faces = await backend.fetchFacesForFile('file-1');
    expect(faces.map((f) => f.id)).toEqual(['new-1']);
    const [status] = await backend.fetchFaceDetectionStatuses(['file-1']);
    expect(status.dateDetected).toEqual(later);
  });

  test('fetchFacesForFiles fetches the faces of several files in one call', async (backend) => {
    await backend.saveFaceDetectionResult(mockStatus({ fileId: 'a' }), [
      mockFace({ id: 'fa', fileId: 'a' }),
    ]);
    await backend.saveFaceDetectionResult(mockStatus({ fileId: 'b' }), [
      mockFace({ id: 'fb', fileId: 'b' }),
    ]);
    await backend.saveFaceDetectionResult(mockStatus({ fileId: 'c' }), [
      mockFace({ id: 'fc', fileId: 'c' }),
    ]);
    const faces = await backend.fetchFacesForFiles(['a', 'c']);
    expect(faces.map((f) => f.id).sort()).toEqual(['fa', 'fc']);
  });

  test("removeFiles also removes those files' faces and statuses", async (backend) => {
    await backend.createFilesFromPath('/loc-L', [mockFile('a', 'L'), mockFile('b', 'L')]);
    await backend.saveFaceDetectionResult(mockStatus({ fileId: 'a' }), [
      mockFace({ id: 'fa', fileId: 'a' }),
    ]);
    await backend.saveFaceDetectionResult(mockStatus({ fileId: 'b' }), [
      mockFace({ id: 'fb', fileId: 'b' }),
    ]);

    await backend.removeFiles(['a']);

    expect(await backend.fetchFacesForFiles(['a', 'b'])).toHaveLength(1);
    expect((await backend.fetchFaceDetectionStatuses(['a', 'b'])).map((s) => s.fileId)).toEqual([
      'b',
    ]);
  });

  test("removeLocation also removes its files' faces and statuses", async (backend) => {
    await backend.createLocation({
      id: 'L',
      path: '/loc-L',
      dateAdded: new Date(),
      subLocations: [],
      index: 0,
    } as any);
    await backend.createFilesFromPath('/loc-L', [mockFile('a', 'L')]);
    await backend.createFilesFromPath('/loc-M', [mockFile('m', 'M')]);
    await backend.saveFaceDetectionResult(mockStatus({ fileId: 'a' }), [
      mockFace({ id: 'fa', fileId: 'a' }),
    ]);
    await backend.saveFaceDetectionResult(mockStatus({ fileId: 'm' }), [
      mockFace({ id: 'fm', fileId: 'm' }),
    ]);

    await backend.removeLocation('L');

    expect((await backend.fetchFiles('id', OrderDirection.Asc)).map((f) => f.id)).toEqual(['m']);
    expect((await backend.fetchFacesForFiles(['a', 'm'])).map((f) => f.id)).toEqual(['fm']);
    expect((await backend.fetchFaceDetectionStatuses(['a', 'm'])).map((s) => s.fileId)).toEqual([
      'm',
    ]);
  });

  test('clearFilesOnly clears faces and statuses', async (backend) => {
    await backend.saveFaceDetectionResult(mockStatus(), [mockFace()]);
    await backend.clearFilesOnly();
    expect(await backend.fetchFacesForFile('file-1')).toEqual([]);
    expect(await backend.fetchFaceDetectionStatuses(['file-1'])).toEqual([]);
  });
});
