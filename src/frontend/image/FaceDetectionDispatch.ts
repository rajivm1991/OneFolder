import { NormalizedBox } from '../../api/face';
import { ModelLoadError, TransientDetectionError } from '../stores/FaceDetectionStore';

// A small pool of face-detection workers. Created lazily on the first request, so windows that
// never run detection (e.g. the preview window, which also constructs a RootStore) spawn none.
const NUM_FACE_DETECTION_WORKERS = 3;
const DEFAULT_TIMEOUT_MS = 30000;

interface DetectedFace {
  boundingBox: NormalizedBox;
  descriptor: number[];
}

interface PendingRequest {
  slot: number;
  resolve: (faces: DetectedFace[]) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const workers: Worker[] = [];
/** Keyed by a unique per-request id — NOT by path, so two requests for the same file can't
 * overwrite each other's listener. */
const pending = new Map<number, PendingRequest>();
let nextRequestId = 0;

function spawnWorker(slot: number): void {
  const worker = new Worker(new URL('src/frontend/workers/faceDetection.worker', import.meta.url));
  worker.addEventListener('message', (e: MessageEvent) => {
    const { type, requestId, faces, message, isModelLoadError } = e.data;
    const request = pending.get(requestId);
    if (!request) {
      return; // already timed out / rejected
    }
    pending.delete(requestId);
    clearTimeout(request.timer);
    if (type === 'result') {
      request.resolve(faces);
    } else {
      request.reject(isModelLoadError ? new ModelLoadError(message) : new Error(message));
    }
  });
  // An uncaught error inside the worker (e.g. it crashed): its in-flight jobs will never answer
  worker.addEventListener('error', (e: ErrorEvent) => {
    restartWorker(slot, `Face detection worker crashed: ${e.message}`);
  });
  workers[slot] = worker;
}

/** Terminates the worker in `slot` — actually stopping any stuck job, unlike merely ignoring its
 * late answer — fails its in-flight requests as transient (so the caller may retry them), and
 * replaces it with a fresh worker. */
function restartWorker(slot: number, reason: string): void {
  workers[slot]?.terminate();
  for (const [requestId, request] of pending) {
    if (request.slot === slot) {
      pending.delete(requestId);
      clearTimeout(request.timer);
      request.reject(new TransientDetectionError(reason));
    }
  }
  spawnWorker(slot);
}

function leastBusySlot(): number {
  const load = workers.map(() => 0);
  for (const request of pending.values()) {
    load[request.slot] += 1;
  }
  return load.indexOf(Math.min(...load));
}

/**
 * Runs face detection for one image in the worker pool. Rejects with:
 * - `ModelLoadError` when the bundled models could not be loaded (don't retry, it's permanent);
 * - `TransientDetectionError` on a timeout or worker crash (the stuck worker is terminated and
 *   respawned; retrying may succeed);
 * - a plain `Error` for a per-image failure such as an undecodable file (retrying won't help).
 */
export function detectFacesUsingWorker(
  imagePath: string,
  timeout = DEFAULT_TIMEOUT_MS,
): Promise<DetectedFace[]> {
  if (workers.length === 0) {
    for (let i = 0; i < NUM_FACE_DETECTION_WORKERS; i++) {
      spawnWorker(i);
    }
  }
  return new Promise((resolve, reject) => {
    const requestId = nextRequestId++;
    const slot = leastBusySlot();
    const timer = setTimeout(() => {
      if (pending.has(requestId)) {
        restartWorker(slot, `Face detection timed out for ${imagePath}`);
      }
    }, timeout);
    pending.set(requestId, { slot, resolve, reject, timer });
    workers[slot].postMessage({ type: 'detect', requestId, imagePath });
  });
}
