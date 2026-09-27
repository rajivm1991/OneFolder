import { FaceDetectionStore } from '../src/frontend/stores/FaceDetectionStore';

describe('FaceDetectionStore', () => {
  it('tracks processed/total counts across a batch and sets isRunning false when done', async () => {
    const saved: unknown[] = [];
    const dataStorage = {
      fetchFileIdsWithFaces: async () => new Set<string>(),
      fetchFacesForFile: async () => [],
      saveFaces: async (faces: unknown[]) => {
        saved.push(...faces);
      },
      removeFacesForFile: async () => {},
    };
    const detectForFile = async (_absolutePath: string) => [
      { boundingBox: { x: 0, y: 0, width: 10, height: 10 }, descriptor: new Array(128).fill(0) },
    ];

    const store = new FaceDetectionStore(dataStorage as any, detectForFile);
    expect(store.isRunning).toBe(false);

    const files = [
      { id: 'f1', absolutePath: '/a.jpg', dateModified: new Date() },
      { id: 'f2', absolutePath: '/b.jpg', dateModified: new Date() },
    ];
    const runPromise = store.runDetectionBatch(files);
    expect(store.isRunning).toBe(true);
    expect(store.totalCount).toBe(2);

    await runPromise;

    expect(store.isRunning).toBe(false);
    expect(store.processedCount).toBe(2);
    expect(saved.length).toBe(2); // one face row per file
  });

  it('skips files already present in fetchFileIdsWithFaces', async () => {
    const saved: unknown[] = [];
    const dataStorage = {
      fetchFileIdsWithFaces: async () => new Set<string>(['f1']),
      fetchFacesForFile: async () => [],
      saveFaces: async (faces: unknown[]) => {
        saved.push(...faces);
      },
      removeFacesForFile: async () => {},
    };
    const detectForFile = async () => [];
    const store = new FaceDetectionStore(dataStorage as any, detectForFile);

    await store.runDetectionBatch([
      { id: 'f1', absolutePath: '/a.jpg', dateModified: new Date() },
      { id: 'f2', absolutePath: '/b.jpg', dateModified: new Date() },
    ]);

    expect(store.processedCount).toBe(1); // only f2 processed
    expect(store.totalCount).toBe(1);
  });

  it('retries once on a transient failure, then gives up on that file without stalling the batch', async () => {
    const saved: unknown[] = [];
    const dataStorage = {
      fetchFileIdsWithFaces: async () => new Set<string>(),
      saveFaces: async (faces: unknown[]) => {
        saved.push(...faces);
      },
      fetchFacesForFile: async () => [],
      removeFacesForFile: async () => {},
    };
    let calls = 0;
    const detectForFile = async () => {
      calls += 1;
      if (calls === 1) {
        throw new Error('transient worker crash');
      }
      return [];
    };
    const store = new FaceDetectionStore(dataStorage as any, detectForFile);

    await store.runDetectionBatch([{ id: 'f1', absolutePath: '/a.jpg', dateModified: new Date() }]);

    expect(calls).toBe(2); // one failure + one retry
    expect(store.processedCount).toBe(1); // still counted as processed, batch didn't stall
    expect(store.isRunning).toBe(false);
  });

  it('sets modelLoadFailed and stops the batch on a ModelLoadError, without retrying', async () => {
    const { ModelLoadError } = await import('../src/frontend/stores/FaceDetectionStore');
    const dataStorage = {
      fetchFileIdsWithFaces: async () => new Set<string>(),
      saveFaces: async () => {},
      fetchFacesForFile: async () => [],
      removeFacesForFile: async () => {},
    };
    let calls = 0;
    const detectForFile = async () => {
      calls += 1;
      throw new ModelLoadError('model file missing');
    };
    const store = new FaceDetectionStore(dataStorage as any, detectForFile);

    await store.runDetectionBatch([{ id: 'f1', absolutePath: '/a.jpg', dateModified: new Date() }]);

    expect(store.modelLoadFailed).toBe(true);
    expect(calls).toBe(1); // no retry for a model-load failure

    // A second batch call short-circuits entirely once modelLoadFailed is set
    await store.runDetectionBatch([{ id: 'f2', absolutePath: '/b.jpg', dateModified: new Date() }]);
    expect(calls).toBe(1); // unchanged — batch returned immediately
  });
});
