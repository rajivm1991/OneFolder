import { FileDTO } from '../src/api/file';
import { FaceDetectionStore } from '../src/frontend/stores/FaceDetectionStore';

describe('LocationStore + FaceDetectionStore integration contract', () => {
  it('enqueueFiles accepts the FileDTOs LocationStore fetches from the DB', async () => {
    const dataStorage = {
      fetchFacesForFiles: async () => [],
      fetchFaceDetectionStatuses: async () => [],
      saveFaceDetectionResult: async () => {},
    };
    const detectForFile = jest.fn(async () => []);
    const store = new FaceDetectionStore(dataStorage, detectForFile);

    const dbFile = {
      id: 'f1',
      absolutePath: '/x.jpg',
      dateLastIndexed: new Date(),
      dateModified: new Date(),
      name: 'x.jpg',
    } as FileDTO;
    await expect(store.enqueueFiles([dbFile])).resolves.toBeUndefined();
    expect(detectForFile).toHaveBeenCalledWith('/x.jpg');
    expect(store.processedCount).toBe(1);
  });
});
