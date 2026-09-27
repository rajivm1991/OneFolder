import * as faceapi from 'face-api.js';
import * as path from 'path';

import { getExtraResourcePath } from '../../../common/fs';
import { NormalizedBox } from '../../api/face';

/** Reads a file into memory. The worker passes `fse.readFile`; tests pass `fs.promises.readFile`. */
export type ReadFileFn = (filePath: string) => Promise<Uint8Array>;

/** The three nets `detectAllFaces(...).withFaceLandmarks(true).withFaceDescriptors()` needs.
 * `.withFaceLandmarks(true)` selects the TINY 68-point landmark net (~80KB), which must be loaded
 * before inference — without it every photo that actually contains a face throws
 * "FaceLandmark68TinyNet - load model before inference" (0-face photos never reach it). */
const MODELS: Array<{ net: faceapi.NeuralNetwork<unknown>; name: string }> = [
  { net: faceapi.nets.tinyFaceDetector, name: 'tiny_face_detector_model' },
  { net: faceapi.nets.faceLandmark68TinyNet, name: 'face_landmark_68_tiny_model' },
  { net: faceapi.nets.faceRecognitionNet, name: 'face_recognition_model' },
];

/** Images are downscaled so their long edge is at most this many pixels before building the
 * tensor. TinyFaceDetector resizes its input to 416px anyway, so this loses no detection accuracy,
 * but it avoids a full-resolution ImageData + int32 tensor (~770MB for an 8000×6000 photo). */
export const MAX_DETECTION_EDGE = 1280;

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  // Node Buffers may be views into a larger shared pool: copy exactly this file's bytes
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/**
 * Loads one net's weights by reading its manifest + shard files straight from disk and decoding
 * them with face-api.js's own nested tfjs-core (`faceapi.tf.io.decodeWeights`), then handing the
 * resulting weight map to `net.loadFromWeightMap`. This deliberately avoids `loadFromUri` (which
 * `fetch()`es — unreliable over Electron's file:// and broken for Windows backslash paths) and
 * `loadFromDisk` (which splits the path on '/' and needs face-api's Node env's readFile).
 */
export async function loadNetFromDisk(
  net: faceapi.NeuralNetwork<unknown>,
  modelsDir: string,
  modelName: string,
  readFile: ReadFileFn,
): Promise<void> {
  const manifestBytes = await readFile(path.join(modelsDir, `${modelName}-weights_manifest.json`));
  const manifest: faceapi.tf.io.WeightsManifestConfig = JSON.parse(
    new TextDecoder().decode(manifestBytes),
  );
  const weightMap: faceapi.tf.NamedTensorMap = {};
  for (const group of manifest) {
    const shards = await Promise.all(
      group.paths.map(async (shard) => toArrayBuffer(await readFile(path.join(modelsDir, shard)))),
    );
    const buffer = faceapi.tf.io.concatenateArrayBuffers(shards);
    Object.assign(weightMap, faceapi.tf.io.decodeWeights(buffer, group.weights));
  }
  net.loadFromWeightMap(weightMap);
}

let modelsLoading: Promise<void> | undefined;

/** Loads all models once per worker. Concurrent callers share the same in-flight promise.
 * A failure is thrown as an Error with an `isModelLoadError` marker (this file runs inside a
 * Worker; the marker crosses the `postMessage` boundary as plain data), and is sticky: the
 * worker won't retry loading a model file that is missing/corrupt. */
function ensureModelsLoaded(modelsDir: string, readFile: ReadFileFn): Promise<void> {
  if (!modelsLoading) {
    modelsLoading = (async () => {
      try {
        for (const { net, name } of MODELS) {
          await loadNetFromDisk(net, modelsDir, name, readFile);
        }
      } catch (err) {
        throw Object.assign(
          new Error(`failed to load face-detection models: ${(err as Error).message}`),
          { isModelLoadError: true },
        );
      }
    })();
  }
  return modelsLoading;
}

export interface DetectedFace {
  boundingBox: NormalizedBox;
  descriptor: number[];
}

/** Anything with RGBA pixel `data` + dimensions — a real ImageData in the worker; a plain
 * object with a Uint8Array `data` in Node-based tests (tfjs-core fromPixels accepts that shape). */
export type PixelSource = Pick<ImageData, 'data' | 'width' | 'height'>;

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
  const scale = Math.min(1, MAX_DETECTION_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Could not get 2D context from OffscreenCanvas');
  }
  ctx.drawImage(bitmap, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height);
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Converts a pixel-space box (in the coordinate space of an image `imgWidth`×`imgHeight`) to a
 * box normalized to 0–1, clamped to the image bounds (detector boxes can overhang the edges). */
export function normalizeBox(
  box: { x: number; y: number; width: number; height: number },
  imgWidth: number,
  imgHeight: number,
): NormalizedBox {
  const x = clamp01(box.x / imgWidth);
  const y = clamp01(box.y / imgHeight);
  const right = clamp01((box.x + box.width) / imgWidth);
  const bottom = clamp01((box.y + box.height) / imgHeight);
  return { x, y, width: right - x, height: bottom - y };
}

export async function detectFacesInPixels(
  pixels: PixelSource,
  modelsDir: string,
  readFile: ReadFileFn,
): Promise<DetectedFace[]> {
  await ensureModelsLoaded(modelsDir, readFile);

  const tensor = faceapi.tf.browser.fromPixels(pixels as ImageData, 3);
  try {
    const detections = await faceapi
      .detectAllFaces(tensor, new faceapi.TinyFaceDetectorOptions())
      .withFaceLandmarks(true)
      .withFaceDescriptors();

    return detections.map((d) => ({
      boundingBox: normalizeBox(d.detection.box, pixels.width, pixels.height),
      descriptor: Array.from(d.descriptor),
    }));
  } finally {
    tensor.dispose();
  }
}

export async function detectFacesInImageBitmap(
  bitmap: ImageBitmap,
  readFile: ReadFileFn,
  modelsDir = getExtraResourcePath('models'),
): Promise<DetectedFace[]> {
  const imageData = bitmapToImageData(bitmap);
  return detectFacesInPixels(imageData, modelsDir, readFile);
}
