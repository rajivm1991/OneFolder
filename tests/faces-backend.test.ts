import { FaceDTO } from '../src/api/face';
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
      boundingBox: { x: 10, y: 20, width: 100, height: 120 },
      descriptor: new Array(128).fill(0).map((_, i) => i * 0.01),
      personId: null,
      dateDetected: new Date('2026-09-27T00:00:00.000Z'),
      ...overrides,
    };
  }

  test('saveFaces then fetchFacesForFile round-trips a face', async (backend) => {
    const face = mockFace();
    await backend.saveFaces([face]);
    const faces = await backend.fetchFacesForFile('file-1');
    expect(faces).toHaveLength(1);
    expect(faces[0]).toEqual(face);
  });

  test('fetchFacesForFile returns empty array for a file with no faces', async (backend) => {
    const faces = await backend.fetchFacesForFile('nonexistent-file');
    expect(faces).toEqual([]);
  });

  test('saveFaces stores multiple faces for the same file (crowd photo)', async (backend) => {
    const face1 = mockFace({ id: 'face-1', boundingBox: { x: 0, y: 0, width: 50, height: 50 } });
    const face2 = mockFace({ id: 'face-2', boundingBox: { x: 100, y: 0, width: 50, height: 50 } });
    await backend.saveFaces([face1, face2]);
    const faces = await backend.fetchFacesForFile('file-1');
    expect(faces).toHaveLength(2);
    expect(faces.map((f) => f.id).sort()).toEqual(['face-1', 'face-2']);
  });

  test('fetchFileIdsWithFaces returns the set of file IDs that have at least one face', async (backend) => {
    await backend.saveFaces([
      mockFace({ id: 'face-1', fileId: 'file-a' }),
      mockFace({ id: 'face-2', fileId: 'file-b' }),
      mockFace({ id: 'face-3', fileId: 'file-a' }),
    ]);
    const fileIds = await backend.fetchFileIdsWithFaces();
    expect(fileIds).toEqual(new Set(['file-a', 'file-b']));
  });

  test('removeFacesForFile deletes only that file\'s faces', async (backend) => {
    await backend.saveFaces([
      mockFace({ id: 'face-1', fileId: 'file-a' }),
      mockFace({ id: 'face-2', fileId: 'file-b' }),
    ]);
    await backend.removeFacesForFile('file-a');
    expect(await backend.fetchFacesForFile('file-a')).toEqual([]);
    expect(await backend.fetchFacesForFile('file-b')).toHaveLength(1);
  });
});
