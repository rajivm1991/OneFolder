export {};

// Stub the Web Worker's OffscreenCanvas API (unavailable under Jest's node test environment) —
// bitmapToImageData() calls these directly; their actual pixel content is irrelevant here since
// faceapi.tf.browser.fromPixels is mocked below and never inspects it.
const canvasSizes: Array<[number, number]> = [];
class FakeOffscreenCanvas {
  constructor(public width: number, public height: number) {
    canvasSizes.push([width, height]);
  }
  getContext() {
    return {
      drawImage: jest.fn(),
      getImageData: jest.fn(
        (_x: number, _y: number, w: number, h: number) =>
          ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h } as ImageData),
      ),
    };
  }
}
(global as unknown as { OffscreenCanvas: unknown }).OffscreenCanvas = FakeOffscreenCanvas;

const mockDispose = jest.fn();
const mockFromPixels = jest.fn((...args: any[]) => ({ dispose: mockDispose }));
const mockWithFaceDescriptors = jest.fn();
const mockWithFaceLandmarks = jest.fn((...args: any[]) => ({
  withFaceDescriptors: mockWithFaceDescriptors,
}));
const mockDetectAllFaces = jest.fn((...args: any[]) => ({
  withFaceLandmarks: mockWithFaceLandmarks,
}));
const loadedNets: string[] = [];
const mockNet = (name: string) => ({
  loadFromWeightMap: jest.fn(() => loadedNets.push(name)),
});
jest.mock('face-api.js', () => ({
  tf: {
    browser: { fromPixels: (...args: any[]) => mockFromPixels(...args) },
    io: {
      concatenateArrayBuffers: (bufs: ArrayBuffer[]) => bufs[0],
      decodeWeights: () => ({}),
    },
  },
  nets: {
    tinyFaceDetector: mockNet('tinyFaceDetector'),
    faceLandmark68TinyNet: mockNet('faceLandmark68TinyNet'),
    faceRecognitionNet: mockNet('faceRecognitionNet'),
  },
  detectAllFaces: (...args: any[]) => mockDetectAllFaces(...args),
  TinyFaceDetectorOptions: jest.fn(),
}));

/** readFile stub: manifests are single-group, single-shard; shards are 4 empty bytes. */
const readFiles: string[] = [];
const mockReadFile = jest.fn(async (filePath: string) => {
  readFiles.push(filePath);
  if (filePath.endsWith('-weights_manifest.json')) {
    const name = filePath.split(/[\\/]/).pop()!.replace('-weights_manifest.json', '');
    return new TextEncoder().encode(JSON.stringify([{ paths: [`${name}-shard1`], weights: [] }]));
  }
  return new Uint8Array(4);
});

describe('detectFacesInImageBitmap', () => {
  // faceDetectionCore.ts caches the model-loading promise at module scope, so each test gets a
  // fresh module instance (jest.resetModules + re-require) — otherwise later tests would silently
  // see the earlier tests' cached "models already loaded" state and give false results.
  let core: typeof import('../src/frontend/workers/faceDetectionCore');

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    loadedNets.length = 0;
    readFiles.length = 0;
    canvasSizes.length = 0;
    mockWithFaceDescriptors.mockResolvedValue([]);
    core = require('../src/frontend/workers/faceDetectionCore');
  });

  it('returns an empty array for an image with no detected faces, without throwing', async () => {
    const result = await core.detectFacesInImageBitmap(
      { width: 10, height: 10 } as ImageBitmap,
      mockReadFile,
      '/models',
    );
    expect(result).toEqual([]);
  });

  it('loads the tiny detector, TINY landmark net and recognition net from disk, without fetch', async () => {
    await core.detectFacesInImageBitmap(
      { width: 10, height: 10 } as ImageBitmap,
      mockReadFile,
      '/models',
    );
    expect(loadedNets).toEqual(['tinyFaceDetector', 'faceLandmark68TinyNet', 'faceRecognitionNet']);
    expect(readFiles.map((p) => p.replace(/\\/g, '/'))).toEqual([
      '/models/tiny_face_detector_model-weights_manifest.json',
      '/models/tiny_face_detector_model-shard1',
      '/models/face_landmark_68_tiny_model-weights_manifest.json',
      '/models/face_landmark_68_tiny_model-shard1',
      '/models/face_recognition_model-weights_manifest.json',
      '/models/face_recognition_model-shard1',
    ]);
    // `true` selects the tiny landmark net — the one that was loaded
    expect(mockWithFaceLandmarks).toHaveBeenCalledWith(true);
  });

  it('maps a detection to a NORMALIZED {boundingBox, descriptor} and disposes the tensor', async () => {
    const descriptor = new Float32Array([0.1, 0.2, 0.3]);
    mockWithFaceDescriptors.mockResolvedValue([
      { detection: { box: { x: 10, y: 20, width: 30, height: 40 } }, descriptor },
    ]);
    const bitmap = { width: 100, height: 200 } as ImageBitmap;
    const result = await core.detectFacesInImageBitmap(bitmap, mockReadFile, '/models');
    expect(result).toHaveLength(1);
    const box = result[0].boundingBox;
    expect(box.x).toBeCloseTo(0.1);
    expect(box.y).toBeCloseTo(0.1);
    expect(box.width).toBeCloseTo(0.3);
    expect(box.height).toBeCloseTo(0.2);
    // Array.from(Float32Array) keeps float32 rounding — compare against the same conversion
    expect(result[0].descriptor).toEqual(Array.from(descriptor));
    expect(mockDispose).toHaveBeenCalledTimes(1); // tensor disposed even on the success path
  });

  it('downscales large images before detection, and boxes stay normalized to the image', async () => {
    mockWithFaceDescriptors.mockResolvedValue([
      // in the coordinate space of the downscaled 1280×960 input
      {
        detection: { box: { x: 640, y: 480, width: 128, height: 96 } },
        descriptor: new Float32Array(1),
      },
    ]);
    const result = await core.detectFacesInImageBitmap(
      { width: 8000, height: 6000 } as ImageBitmap,
      mockReadFile,
      '/models',
    );
    expect(canvasSizes).toEqual([[core.MAX_DETECTION_EDGE, 960]]);
    expect(result[0].boundingBox.x).toBeCloseTo(0.5);
    expect(result[0].boundingBox.y).toBeCloseTo(0.5);
    expect(result[0].boundingBox.width).toBeCloseTo(0.1);
    expect(result[0].boundingBox.height).toBeCloseTo(0.1);
  });

  it('clamps boxes overhanging the image edge to 0–1', () => {
    expect(core.normalizeBox({ x: -10, y: 90, width: 30, height: 20 }, 100, 100)).toEqual({
      x: 0,
      y: 0.9,
      width: 0.2,
      height: expect.closeTo(0.1),
    });
  });

  it('disposes the tensor even when detection throws', async () => {
    mockWithFaceDescriptors.mockRejectedValue(new Error('detection failed'));
    await expect(
      core.detectFacesInImageBitmap(
        { width: 10, height: 10 } as ImageBitmap,
        mockReadFile,
        '/models',
      ),
    ).rejects.toThrow('detection failed');
    expect(mockDispose).toHaveBeenCalledTimes(1);
  });

  it('only loads the models once across multiple (and concurrent) calls', async () => {
    const bitmap = { width: 10, height: 10 } as ImageBitmap;
    await Promise.all([
      core.detectFacesInImageBitmap(bitmap, mockReadFile, '/models'),
      core.detectFacesInImageBitmap(bitmap, mockReadFile, '/models'),
    ]);
    await core.detectFacesInImageBitmap(bitmap, mockReadFile, '/models');
    expect(loadedNets).toHaveLength(3); // 3 nets loaded once each, not per call
  });

  it('flags a missing model file as a model-load error', async () => {
    const failingRead = async () => {
      throw new Error('ENOENT: no such file or directory');
    };
    await expect(
      core.detectFacesInImageBitmap(
        { width: 10, height: 10 } as ImageBitmap,
        failingRead,
        '/models',
      ),
    ).rejects.toMatchObject({ isModelLoadError: true });
  });
});
