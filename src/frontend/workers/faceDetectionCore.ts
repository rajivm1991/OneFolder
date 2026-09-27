import * as faceapi from 'face-api.js';
import * as tf from '@tensorflow/tfjs';

let modelsLoaded = false;
let modelsFailedToLoad = false;

/** Distinguishes "the bundled model file is missing/corrupt" from a per-image detection
 * failure — thrown as a plain object with a `isModelLoadError` marker rather than importing
 * `ModelLoadError` from the store (this file runs inside a Worker, `FaceDetectionStore` runs
 * on the main thread; the marker crosses the `postMessage` boundary as plain data instead). */
async function ensureModelsLoaded(modelsUri: string): Promise<void> {
  if (modelsFailedToLoad) {
    throw Object.assign(new Error('face-detection models previously failed to load'), {
      isModelLoadError: true,
    });
  }
  if (modelsLoaded) {
    return;
  }
  try {
    await faceapi.nets.tinyFaceDetector.loadFromUri(modelsUri);
    await faceapi.nets.faceRecognitionNet.loadFromUri(modelsUri);
    modelsLoaded = true;
  } catch (err) {
    modelsFailedToLoad = true;
    throw Object.assign(new Error(`failed to load face-detection models: ${(err as Error).message}`), {
      isModelLoadError: true,
    });
  }
}

export interface DetectedFace {
  boundingBox: { x: number; y: number; width: number; height: number };
  descriptor: number[];
}

export async function detectFacesInImageBitmap(
  bitmap: ImageBitmap,
  modelsUri = './resources/models',
): Promise<DetectedFace[]> {
  await ensureModelsLoaded(modelsUri);

  const tensor = tf.browser.fromPixels(bitmap, 3);
  try {
    // face-api.js's TS types for detectAllFaces only declare `tf.Tensor4D` (from face-api.js's
    // own bundled `@tensorflow/tfjs-core` copy) as an accepted tensor input, but its runtime
    // `NetInput` constructor explicitly branches on and accepts a `Tensor3D` too (see
    // `node_modules/face-api.js/build/commonjs/dom/NetInput.js`, `isTensor3D` branch) —
    // `tf.browser.fromPixels` (from our separately-installed `@tensorflow/tfjs`) returns a
    // `Tensor3D`. The two packages' `Tensor4D`/`Tensor3D` types are structurally identical but
    // nominally distinct TS classes, so a plain cast is rejected; `as unknown as any` bridges
    // the type-only mismatch, not a runtime one.
    const detections = await faceapi
      .detectAllFaces(tensor as unknown as any, new faceapi.TinyFaceDetectorOptions())
      .withFaceLandmarks()
      .withFaceDescriptors();

    return detections.map((d: any) => ({
      boundingBox: {
        x: d.detection.box.x,
        y: d.detection.box.y,
        width: d.detection.box.width,
        height: d.detection.box.height,
      },
      descriptor: Array.from(d.descriptor as Float32Array),
    }));
  } finally {
    tensor.dispose();
  }
}
