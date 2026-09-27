import { ModelLoadError } from '../stores/FaceDetectionStore';

// Set up multiple workers for max performance, mirroring ThumbnailGeneration.tsx's worker pool pattern
const NUM_FACE_DETECTION_WORKERS = 3;
const workers: Worker[] = [];
for (let i = 0; i < NUM_FACE_DETECTION_WORKERS; i++) {
  workers[i] = new Worker(new URL('src/frontend/workers/faceDetection.worker', import.meta.url));
}

interface DetectedFace {
  boundingBox: { x: number; y: number; width: number; height: number };
  descriptor: number[];
}

const listeners = new Map<string, (result: DetectedFace[]) => void>();
const errorListeners = new Map<string, (err: Error) => void>();

for (const worker of workers) {
  worker.addEventListener('message', (e: MessageEvent) => {
    const { type, fileId, faces, message, isModelLoadError } = e.data;
    if (type === 'result') {
      listeners.get(fileId)?.(faces);
    } else if (type === 'error') {
      errorListeners.get(fileId)?.(isModelLoadError ? new ModelLoadError(message) : new Error(message));
    }
    listeners.delete(fileId);
    errorListeners.delete(fileId);
  });
}

let lastSubmittedWorker = 0;

/**
 * Dispatches a face detection request to a pool of `faceDetection.worker.ts` instances,
 * round-robin, and routes the response back to the caller via a `fileId`-keyed listener map.
 * `fileId` here is only a per-request routing key (see `RootStore.ts` — `absolutePath` is
 * passed twice since it is unique per file); it is not the DB file id.
 */
export function detectFacesUsingWorker(
  fileId: string,
  imagePath: string,
  timeout = 15000,
): Promise<DetectedFace[]> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      listeners.delete(fileId);
      errorListeners.delete(fileId);
      reject(new Error(`Face detection timed out for ${imagePath}`));
    }, timeout);

    listeners.set(fileId, (faces) => {
      clearTimeout(timer);
      resolve(faces);
    });
    errorListeners.set(fileId, (err) => {
      clearTimeout(timer);
      reject(err);
    });

    lastSubmittedWorker = (lastSubmittedWorker + 1) % workers.length;
    workers[lastSubmittedWorker].postMessage({ type: 'detect', fileId, imagePath });
  });
}
