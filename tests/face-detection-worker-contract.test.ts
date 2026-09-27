export {};

// Stub the Web Worker's OffscreenCanvas API (unavailable under Jest's node test environment) —
// bitmapToImageData() calls these directly; their actual pixel content is irrelevant here since
// faceapi.tf.browser.fromPixels is mocked below and never inspects it.
class FakeOffscreenCanvas {
  constructor(
    public width: number,
    public height: number,
  ) {}
  getContext() {
    return {
      drawImage: jest.fn(),
      getImageData: jest.fn(
        () => ({ data: new Uint8ClampedArray(this.width * this.height * 4) }) as ImageData,
      ),
    };
  }
}
(global as unknown as { OffscreenCanvas: unknown }).OffscreenCanvas = FakeOffscreenCanvas;

const mockDispose = jest.fn();
const mockFromPixels = jest.fn((...args: any[]) => ({ dispose: mockDispose }));
const mockWithFaceDescriptors = jest.fn();
const mockDetectAllFaces = jest.fn((...args: any[]) => ({
  withFaceLandmarks: () => ({ withFaceDescriptors: mockWithFaceDescriptors }),
}));
const mockLoadFromUri = jest.fn().mockResolvedValue(undefined);
jest.mock('face-api.js', () => ({
  tf: { browser: { fromPixels: (...args: any[]) => mockFromPixels(...args) } },
  nets: {
    tinyFaceDetector: { loadFromUri: (...args: any[]) => mockLoadFromUri(...args) },
    faceRecognitionNet: { loadFromUri: (...args: any[]) => mockLoadFromUri(...args) },
  },
  detectAllFaces: (...args: any[]) => mockDetectAllFaces(...args),
  TinyFaceDetectorOptions: jest.fn(),
}));

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
    const descriptor = new Float32Array([0.1, 0.2, 0.3]);
    mockWithFaceDescriptors.mockResolvedValue([
      { detection: { box: { x: 1, y: 2, width: 3, height: 4 } }, descriptor },
    ]);
    const bitmap = { width: 10, height: 10 } as ImageBitmap;
    const result = await detectFacesInImageBitmap(bitmap);
    expect(result).toEqual([
      // Array.from(Float32Array) keeps float32 rounding — compare against the same
      // conversion rather than a hand-typed literal, which would mismatch on precision.
      { boundingBox: { x: 1, y: 2, width: 3, height: 4 }, descriptor: Array.from(descriptor) },
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
