import * as faceapi from 'face-api.js';
import * as fs from 'fs';
import * as path from 'path';

import { detectFacesInPixels } from '../src/frontend/workers/faceDetectionCore';

// No mocks here: loads the REAL bundled weights from resources/models through the same
// disk-based loader the worker uses, and runs each net's real inference graph. A missing or
// mismatched model file (e.g. the landmark model not being bundled) fails this test.
const MODELS_DIR = path.join(__dirname, '..', 'resources', 'models');
const readFile = (p: string) => fs.promises.readFile(p);

describe('bundled face-detection models (real weights, no mocks)', () => {
  jest.setTimeout(60000);

  it('bundles manifest + shard files for all three nets the pipeline uses', () => {
    for (const name of [
      'tiny_face_detector_model',
      'face_landmark_68_tiny_model',
      'face_recognition_model',
    ]) {
      const manifestPath = path.join(MODELS_DIR, `${name}-weights_manifest.json`);
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      for (const group of manifest) {
        for (const shard of group.paths) {
          expect(fs.existsSync(path.join(MODELS_DIR, shard))).toBe(true);
        }
      }
    }
  });

  it('loads all models and runs the full pipeline on a blank image (0 faces, no error)', async () => {
    const width = 128;
    const height = 96;
    const blank = { data: new Uint8Array(width * height * 4).fill(255), width, height };
    const faces = await detectFacesInPixels(blank as unknown as ImageData, MODELS_DIR, readFile);
    expect(faces).toEqual([]);
    expect(faceapi.nets.tinyFaceDetector.isLoaded).toBe(true);
    expect(faceapi.nets.faceLandmark68TinyNet.isLoaded).toBe(true);
    expect(faceapi.nets.faceRecognitionNet.isLoaded).toBe(true);
  });

  it('the loaded landmark and recognition nets actually run inference', async () => {
    // Run after the previous test loaded the weights; a blank 0-face image never reaches these
    // two nets, so exercise them directly to prove their weights fit their inference graphs.
    const faceCrop = faceapi.tf.zeros([112, 112, 3]) as faceapi.tf.Tensor3D;
    try {
      const landmarks = (await faceapi.nets.faceLandmark68TinyNet.detectLandmarks(
        faceCrop,
      )) as faceapi.FaceLandmarks68;
      expect(landmarks.positions).toHaveLength(68);

      const descriptor = (await faceapi.nets.faceRecognitionNet.computeFaceDescriptor(
        faceCrop,
      )) as Float32Array;
      expect(descriptor).toHaveLength(128);
    } finally {
      faceCrop.dispose();
    }
  });
});
