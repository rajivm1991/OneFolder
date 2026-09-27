const mockDispose = jest.fn();
const mockFromPixels = jest.fn((...args: any[]) => ({ dispose: mockDispose }));
jest.mock('@tensorflow/tfjs', () => ({
  browser: { fromPixels: (...args: any[]) => mockFromPixels(...args) },
}));

const mockWithFaceDescriptors = jest.fn();
const mockDetectAllFaces = jest.fn((...args: any[]) => ({
  withFaceLandmarks: () => ({ withFaceDescriptors: mockWithFaceDescriptors }),
}));
const mockLoadFromUri = jest.fn().mockResolvedValue(undefined);
jest.mock('face-api.js', () => ({
  nets: {
    tinyFaceDetector: { loadFromUri: (...args: any[]) => mockLoadFromUri(...args) },
    faceRecognitionNet: { loadFromUri: (...args: any[]) => mockLoadFromUri(...args) },
  },
  detectAllFaces: (...args: any[]) => mockDetectAllFaces(...args),
  TinyFaceDetectorOptions: jest.fn(),
}));

export {};

describe('detectFacesInImageBitmap', () => {
  // faceDetectionCore.ts caches `modelsLoaded` at module scope, so each test gets a fresh
  // module instance (jest.resetModules + re-require) — otherwise later tests would silently
  // see the earlier tests' cached "models already loaded" state and give false results.
  let detectFacesInImageBitmap: typeof import('../src/frontend/workers/faceDetectionCore').detectFacesInImageBitmap;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    mockWithFaceDescriptors.mockResolvedValue([]);
    detectFacesInImageBitmap =
      require('../src/frontend/workers/faceDetectionCore').detectFacesInImageBitmap;
  });

  it('returns an empty array for an image with no detected faces, without throwing', async () => {
    const blankBitmap = { width: 10, height: 10 } as ImageBitmap;
    const result = await detectFacesInImageBitmap(blankBitmap);
    expect(result).toEqual([]);
  });

  it('maps a detection result to {boundingBox, descriptor} and disposes the tensor', async () => {
    mockWithFaceDescriptors.mockResolvedValue([
      {
        detection: { box: { x: 1, y: 2, width: 3, height: 4 } },
        descriptor: new Float32Array([0.1, 0.2, 0.3]),
      },
    ]);
    const bitmap = { width: 10, height: 10 } as ImageBitmap;
    const result = await detectFacesInImageBitmap(bitmap);
    // Float32Array -> number[] loses precision (0.1 becomes 0.10000000149011612 etc.), so the
    // expected descriptor values below match what Array.from(new Float32Array(...)) actually
    // produces, not the original float64 literals.
    expect(result).toEqual([
      {
        boundingBox: { x: 1, y: 2, width: 3, height: 4 },
        descriptor: Array.from(new Float32Array([0.1, 0.2, 0.3])),
      },
    ]);
    expect(mockDispose).toHaveBeenCalledTimes(1); // tensor disposed even on the success path
  });

  it('disposes the tensor even when detection throws', async () => {
    mockWithFaceDescriptors.mockRejectedValue(new Error('detection failed'));
    const bitmap = { width: 10, height: 10 } as ImageBitmap;
    await expect(detectFacesInImageBitmap(bitmap)).rejects.toThrow('detection failed');
    expect(mockDispose).toHaveBeenCalledTimes(1);
  });

  it('only loads the models once across multiple calls', async () => {
    await detectFacesInImageBitmap({ width: 10, height: 10 } as ImageBitmap);
    await detectFacesInImageBitmap({ width: 10, height: 10 } as ImageBitmap);
    expect(mockLoadFromUri).toHaveBeenCalledTimes(2); // 2 nets loaded once each, not per-call
  });
});
