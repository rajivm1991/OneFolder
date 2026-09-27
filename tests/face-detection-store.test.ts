import { FaceDetectionStatusDTO, FaceDTO } from '../src/api/face';
import {
  FaceDetectionStore,
  FileForDetection,
  ModelLoadError,
  TransientDetectionError,
  needsDetection,
} from '../src/frontend/stores/FaceDetectionStore';

/** In-memory stand-in for the Dexie backend's face detection methods. */
function createFakeStorage(initialStatuses: FaceDetectionStatusDTO[] = []) {
  const statuses = new Map(initialStatuses.map((s) => [s.fileId, s]));
  const faces: FaceDTO[] = [];
  return {
    statuses,
    faces,
    fetchFacesForFiles: async (ids: string[]) => faces.filter((f) => ids.includes(f.fileId)),
    fetchFaceDetectionStatuses: async (ids: string[]) =>
      ids.map((id) => statuses.get(id)).filter((s): s is FaceDetectionStatusDTO => !!s),
    saveFaceDetectionResult: async (status: FaceDetectionStatusDTO, newFaces: FaceDTO[]) => {
      for (let i = faces.length - 1; i >= 0; i--) {
        if (faces[i].fileId === status.fileId) {
          faces.splice(i, 1);
        }
      }
      faces.push(...newFaces);
      statuses.set(status.fileId, status);
    },
  };
}

const oneFace = [
  { boundingBox: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 }, descriptor: new Array(128).fill(0) },
];

function file(id: string, dateLastIndexed = new Date('2026-01-01')): FileForDetection {
  return { id, absolutePath: `/${id}.jpg`, dateLastIndexed };
}

describe('needsDetection', () => {
  const indexed = new Date('2026-06-01');
  it('is true when the file was never attempted', () => {
    expect(needsDetection(file('a', indexed), undefined)).toBe(true);
  });
  it('is false when detection happened after the file was last indexed', () => {
    const status: FaceDetectionStatusDTO = {
      fileId: 'a',
      status: 'done',
      dateDetected: new Date('2026-07-01'),
    };
    expect(needsDetection(file('a', indexed), status)).toBe(false);
  });
  it('is false for a failed attempt too (not retried every session)', () => {
    const status: FaceDetectionStatusDTO = {
      fileId: 'a',
      status: 'failed',
      dateDetected: new Date('2026-07-01'),
    };
    expect(needsDetection(file('a', indexed), status)).toBe(false);
  });
  it('is true when the file was re-indexed (changed on disk) after detection', () => {
    const status: FaceDetectionStatusDTO = {
      fileId: 'a',
      status: 'done',
      dateDetected: new Date('2026-05-01'),
    };
    expect(needsDetection(file('a', indexed), status)).toBe(true);
  });
});

describe('FaceDetectionStore', () => {
  it('processes every file, records a status for each (0 faces included), and tracks progress', async () => {
    const storage = createFakeStorage();
    const detect = jest.fn(async (path: string) => (path === '/a.jpg' ? oneFace : []));
    const store = new FaceDetectionStore(storage, detect);
    expect(store.isRunning).toBe(false);

    const run = store.enqueueFiles([file('a'), file('b')]);
    await Promise.resolve(); // let the status lookup resolve
    await Promise.resolve();
    expect(store.isRunning).toBe(true);
    expect(store.totalCount).toBe(2);
    await run;

    expect(store.isRunning).toBe(false);
    expect(store.processedCount).toBe(2);
    expect(storage.faces.map((f) => f.fileId)).toEqual(['a']);
    expect(storage.statuses.get('a')?.status).toBe('done');
    expect(storage.statuses.get('b')?.status).toBe('done'); // 0-face photo is still marked done
  });

  it('does not rescan 0-face or already-detected files on a later enqueue', async () => {
    const storage = createFakeStorage();
    const detect = jest.fn(async () => []);
    const store = new FaceDetectionStore(storage, detect);

    await store.enqueueFiles([file('a'), file('b')]);
    expect(detect).toHaveBeenCalledTimes(2);

    await store.enqueueFiles([file('a'), file('b')]);
    expect(detect).toHaveBeenCalledTimes(2); // nothing re-run
    expect(store.isRunning).toBe(false);
  });

  it('re-detects a file re-indexed after its last detection and replaces its stale faces', async () => {
    const storage = createFakeStorage([
      { fileId: 'changed', status: 'done', dateDetected: new Date('2026-01-01') },
      { fileId: 'unchanged', status: 'done', dateDetected: new Date('2026-01-01') },
    ]);
    storage.faces.push({
      id: 'stale',
      fileId: 'changed',
      boundingBox: { x: 0, y: 0, width: 1, height: 1 },
      descriptor: [],
      personId: null,
      dateDetected: new Date('2026-01-01'),
    });
    const detect = jest.fn(async () => oneFace);
    const store = new FaceDetectionStore(storage, detect);

    await store.enqueueFiles([
      file('changed', new Date('2026-02-01')), // re-indexed after detection
      file('unchanged', new Date('2025-12-01')),
    ]);

    expect(detect).toHaveBeenCalledTimes(1);
    expect(detect).toHaveBeenCalledWith('/changed.jpg');
    expect(storage.faces.filter((f) => f.fileId === 'changed')).toHaveLength(1);
    expect(storage.faces.some((f) => f.id === 'stale')).toBe(false);
    expect(storage.statuses.get('changed')!.dateDetected.getTime()).toBeGreaterThan(
      new Date('2026-02-01').getTime(),
    );
  });

  it('dedupes overlapping enqueue calls into one queue and one drain', async () => {
    const storage = createFakeStorage();
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const detect = jest.fn(async () => {
      await gate;
      return [];
    });
    const store = new FaceDetectionStore(storage, detect);

    const first = store.enqueueFiles([file('a'), file('b'), file('c')]);
    const second = store.enqueueFiles([file('b'), file('c'), file('d')]); // overlaps with first
    await new Promise((r) => setTimeout(r, 0));
    const third = store.enqueueFiles([file('a'), file('d')]); // a is in flight, d is queued
    await new Promise((r) => setTimeout(r, 0));
    release();
    await Promise.all([first, second, third]);

    expect(detect).toHaveBeenCalledTimes(4); // a, b, c, d exactly once each
    expect(new Set(detect.mock.calls.map((c) => (c as unknown[])[0]))).toEqual(
      new Set(['/a.jpg', '/b.jpg', '/c.jpg', '/d.jpg']),
    );
    expect(store.totalCount).toBe(4);
    expect(store.processedCount).toBe(4);
    expect(store.isRunning).toBe(false);
  });

  it('runs at most 3 detections at a time', async () => {
    const storage = createFakeStorage();
    let active = 0;
    let maxActive = 0;
    const detect = async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 1));
      active -= 1;
      return [];
    };
    const store = new FaceDetectionStore(storage, detect);
    await store.enqueueFiles(Array.from({ length: 10 }, (_, i) => file(`f${i}`)));
    expect(maxActive).toBe(3);
    expect(store.processedCount).toBe(10);
  });

  it('retries once on a transient failure (timeout/crash), then succeeds', async () => {
    const storage = createFakeStorage();
    let calls = 0;
    const detect = async () => {
      calls += 1;
      if (calls === 1) {
        throw new TransientDetectionError('worker timed out');
      }
      return oneFace;
    };
    const store = new FaceDetectionStore(storage, detect);
    await store.enqueueFiles([file('a')]);

    expect(calls).toBe(2);
    expect(storage.statuses.get('a')?.status).toBe('done');
    expect(storage.faces).toHaveLength(1);
  });

  it('gives up after one retry and records the file as failed, without stalling the queue', async () => {
    const storage = createFakeStorage();
    const detect = jest.fn(async (path: string) => {
      if (path === '/a.jpg') {
        throw new TransientDetectionError('worker crashed');
      }
      return [];
    });
    const store = new FaceDetectionStore(storage, detect);
    await store.enqueueFiles([file('a'), file('b')]);

    expect(detect.mock.calls.filter((c) => c[0] === '/a.jpg')).toHaveLength(2);
    expect(storage.statuses.get('a')?.status).toBe('failed');
    expect(storage.statuses.get('b')?.status).toBe('done');
    expect(store.processedCount).toBe(2);
    expect(store.isRunning).toBe(false);
  });

  it('does not retry a non-transient (e.g. undecodable image) error; marks the file failed', async () => {
    const storage = createFakeStorage();
    const detect = jest.fn(async () => {
      throw new Error('The source image could not be decoded.');
    });
    const store = new FaceDetectionStore(storage, detect);
    await store.enqueueFiles([file('corrupt')]);

    expect(detect).toHaveBeenCalledTimes(1);
    expect(storage.statuses.get('corrupt')?.status).toBe('failed');

    await store.enqueueFiles([file('corrupt')]); // not retried in a later pass either
    expect(detect).toHaveBeenCalledTimes(1);
  });

  it('sets modelLoadFailed on a ModelLoadError, writes no status, and stops', async () => {
    const storage = createFakeStorage();
    const detect = jest.fn(async () => {
      throw new ModelLoadError('model file missing');
    });
    const store = new FaceDetectionStore(storage, detect);

    await store.enqueueFiles([file('a'), file('b'), file('c'), file('d'), file('e')]);

    expect(store.modelLoadFailed).toBe(true);
    expect(store.isRunning).toBe(false);
    // The 3 concurrent runners each hit it at most once; the remaining queue is dropped
    expect(detect.mock.calls.length).toBeLessThanOrEqual(3);
    expect(storage.statuses.size).toBe(0); // nothing marked attempted: retried next session

    await store.enqueueFiles([file('f')]);
    expect(detect.mock.calls.length).toBeLessThanOrEqual(3); // short-circuits entirely
  });

  it('keeps draining when saving a result fails', async () => {
    const storage = createFakeStorage();
    const save = storage.saveFaceDetectionResult;
    storage.saveFaceDetectionResult = async (status, faces) => {
      if (status.fileId === 'a') {
        throw new Error('DB error');
      }
      return save(status, faces);
    };
    const store = new FaceDetectionStore(storage, async () => []);
    await store.enqueueFiles([file('a'), file('b')]);
    expect(store.processedCount).toBe(2);
    expect(storage.statuses.has('b')).toBe(true);
  });
});
