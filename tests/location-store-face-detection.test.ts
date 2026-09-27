import { FaceDetectionStore } from '../src/frontend/stores/FaceDetectionStore';

describe('LocationStore + FaceDetectionStore integration contract', () => {
  it('runDetectionBatch is callable with the shape LocationStore produces from discovered files', async () => {
    const dataStorage = {
      fetchFileIdsWithFaces: async () => new Set<string>(),
      fetchFacesForFile: async () => [],
      saveFaces: async () => {},
      removeFacesForFile: async () => {},
    };
    const detectForFile = async () => [];
    const store = new FaceDetectionStore(dataStorage as any, detectForFile);

    const discoveredFiles = [{ id: 'f1', absolutePath: '/x.jpg', dateModified: new Date() }];
    await expect(store.runDetectionBatch(discoveredFiles)).resolves.toBeUndefined();
    expect(store.processedCount).toBe(1);
  });
});
