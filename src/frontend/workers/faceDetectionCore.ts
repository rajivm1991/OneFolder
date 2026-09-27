import * as faceapi from 'face-api.js';

import { getExtraResourcePath } from '../../../common/fs';

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

// face-api.js bundles its OWN nested, separate copy of @tensorflow/tfjs-core (a different
// module instance from this project's top-level @tensorflow/tfjs). Its NetInput resolver does a
// strict `instanceof tf.Tensor` check against its OWN nested tfjs-core's Tensor class, so a
// tensor built with the outer @tensorflow/tfjs package would silently fail that check and fall
// through to a broken Canvas/DOM path. We must build the tensor with face-api.js's own
// re-exported `tf` (`faceapi.tf`) instead, so it's the same nested tfjs-core instance NetInput
// checks against. That old nested tfjs-core also can't accept a raw ImageBitmap (no
// `instanceof ImageBitmap` branch and no registered GPU/CPU kernel on its own isolated ENGINE
// singleton), so we draw the bitmap onto our own OffscreenCanvas and pass a real ImageData
// object instead — a Web-platform builtin (not defined by tfjs), so there's no
// module-duplication problem for it, and fromPixels explicitly supports ImageData.
function bitmapToImageData(bitmap: ImageBitmap): ImageData {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Could not get 2D context from OffscreenCanvas');
  }
  ctx.drawImage(bitmap, 0, 0);
  return ctx.getImageData(0, 0, bitmap.width, bitmap.height);
}

export async function detectFacesInImageBitmap(
  bitmap: ImageBitmap,
  modelsUri = getExtraResourcePath('models'),
): Promise<DetectedFace[]> {
  await ensureModelsLoaded(modelsUri);

  const imageData = bitmapToImageData(bitmap);
  const tensor = faceapi.tf.browser.fromPixels(imageData, 3);
  try {
    const detections = await faceapi
      .detectAllFaces(tensor, new faceapi.TinyFaceDetectorOptions())
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
