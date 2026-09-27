import { FaceDetectionStatusDTO, FaceDTO } from '../src/api/face';
import { PersonDTO } from '../src/api/person';
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
  const people: PersonDTO[] = [];
  return {
    statuses,
    faces,
    people,
    fetchFacesForFiles: async (ids: string[]) => faces.filter((f) => ids.includes(f.fileId)),
    fetchFaceDetectionStatuses: async (ids: string[]) =>
      ids.map((id) => statuses.get(id)).filter((s): s is FaceDetectionStatusDTO => !!s),
    // A fresh copy, like a real backend: the store's cache must never alias the stored rows
    fetchAllPeople: async () => people.map((p) => ({ ...p })),
    renamePerson: async (personId: string, name: string) => {
      const person = people.find((p) => p.id === personId);
      if (person !== undefined) {
        person.name = name;
      }
    },
    saveFaceDetectionResult: async (
      status: FaceDetectionStatusDTO,
      newFaces: FaceDTO[],
      newPeople: PersonDTO[],
    ) => {
      for (let i = faces.length - 1; i >= 0; i--) {
        if (faces[i].fileId === status.fileId) {
          faces.splice(i, 1);
        }
      }
      faces.push(...newFaces);
      // Mirrors the real backends: insert only people that don't have a row yet
      for (const p of newPeople) {
        if (!people.some((existing) => existing.id === p.id)) {
          people.push(p);
        }
      }
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
    storage.saveFaceDetectionResult = async (status, faces, newPeople) => {
      if (status.fileId === 'a') {
        throw new Error('DB error');
      }
      return save(status, faces, newPeople);
    };
    const store = new FaceDetectionStore(storage, async () => []);
    await store.enqueueFiles([file('a'), file('b')]);
    expect(store.processedCount).toBe(2);
    expect(storage.statuses.has('b')).toBe(true);
  });

  it('assigns a new person to a face that matches no existing person', async () => {
    const savedPeople: PersonDTO[] = [];
    const savedFaces: FaceDTO[] = [];
    const dataStorage = {
      fetchFacesForFiles: async () => [],
      fetchFaceDetectionStatuses: async () => [],
      fetchAllPeople: async () => [],
      saveFaceDetectionResult: async (
        _status: FaceDetectionStatusDTO,
        faces: FaceDTO[],
        newPeople: PersonDTO[],
      ) => {
        savedFaces.push(...faces);
        savedPeople.push(...newPeople);
      },
    };
    const detectForFile = async () => [
      { boundingBox: { x: 0, y: 0, width: 0.1, height: 0.1 }, descriptor: new Array(128).fill(0.1) },
    ];
    const store = new FaceDetectionStore(dataStorage as any, detectForFile);

    await store.enqueueFiles([{ id: 'f1', absolutePath: '/a.jpg', dateLastIndexed: new Date() }]);

    expect(savedPeople).toHaveLength(1);
    expect(savedFaces).toHaveLength(1);
    expect(savedFaces[0].personId).toBe(savedPeople[0].id);
  });

  it('assigns an existing person to a face with a close-enough descriptor, without creating a new one', async () => {
    const closeDescriptor = new Array(128).fill(0.1);
    closeDescriptor[0] = 0.11; // small perturbation, well under the 0.6 threshold
    const existingPerson: PersonDTO = {
      id: 'person-existing',
      name: 'Known',
      representativeDescriptor: new Array(128).fill(0.1),
      dateCreated: new Date(),
    };
    const savedPeople: PersonDTO[] = [];
    const savedFaces: FaceDTO[] = [];
    const dataStorage = {
      fetchFacesForFiles: async () => [],
      fetchFaceDetectionStatuses: async () => [],
      fetchAllPeople: async () => [existingPerson],
      saveFaceDetectionResult: async (
        _status: FaceDetectionStatusDTO,
        faces: FaceDTO[],
        newPeople: PersonDTO[],
      ) => {
        savedFaces.push(...faces);
        savedPeople.push(...newPeople);
      },
    };
    const detectForFile = async () => [
      { boundingBox: { x: 0, y: 0, width: 0.1, height: 0.1 }, descriptor: closeDescriptor },
    ];
    const store = new FaceDetectionStore(dataStorage as any, detectForFile);

    await store.enqueueFiles([{ id: 'f1', absolutePath: '/a.jpg', dateLastIndexed: new Date() }]);

    // No new person created: the only person sent along is the existing one the face references
    // (re-sent on purpose so the backend can recreate it if it was pruned meanwhile).
    expect(savedPeople.map((p) => p.id)).toEqual(['person-existing']);
    expect(savedFaces[0].personId).toBe('person-existing');
  });

  it('assigns two faces of the same new person (from different files in the same batch) to the SAME person, not two', async () => {
    const sharedDescriptor = new Array(128).fill(0.2);
    const savedPeople: PersonDTO[] = [];
    const savedFaces: FaceDTO[] = [];
    const dataStorage = {
      fetchFacesForFiles: async () => [],
      fetchFaceDetectionStatuses: async () => [],
      fetchAllPeople: async () => [],
      saveFaceDetectionResult: async (
        _status: FaceDetectionStatusDTO,
        faces: FaceDTO[],
        newPeople: PersonDTO[],
      ) => {
        savedFaces.push(...faces);
        savedPeople.push(...newPeople);
      },
    };
    // Both files' faces have (near-)identical descriptors, simulating two photos of the same
    // new person processed concurrently (CONCURRENCY = 3, so both are in-flight together).
    const detectForFile = async () => [
      { boundingBox: { x: 0, y: 0, width: 0.1, height: 0.1 }, descriptor: sharedDescriptor },
    ];
    const store = new FaceDetectionStore(dataStorage as any, detectForFile);

    await store.enqueueFiles([
      { id: 'f1', absolutePath: '/a.jpg', dateLastIndexed: new Date() },
      { id: 'f2', absolutePath: '/b.jpg', dateLastIndexed: new Date() },
    ]);

    // Exactly one person created, not two (each file's save references it, so it's sent twice)
    expect(new Set(savedPeople.map((p) => p.id)).size).toBe(1);
    expect(new Set(savedFaces.map((f) => f.personId)).size).toBe(1);
  });

  it('memoizes the in-flight fetchAllPeople call so concurrent runners share one cache, even under variable latency', async () => {
    // Regression test for a TOCTOU bug: an implementation that memoizes only the RESOLVED value
    // (`if (this.peopleCache === undefined) { this.peopleCache = await fetchAllPeople(); }`) lets
    // two concurrent runners both pass the `undefined` check before either fetch resolves, each
    // kick off their own fetchAllPeople() call, and have the later one overwrite the cache and
    // silently drop any Person the other runner already pushed into it via assignPerson.
    // fetchAllPeople's first call is made artificially slow (and its second call, if any, fast) so
    // a "last write wins" bug reliably surfaces instead of depending on incidental mock timing.
    let fetchAllPeopleCallCount = 0;
    const sharedDescriptor = new Array(128).fill(0.3);
    const savedPeople: PersonDTO[] = [];
    const savedFaces: FaceDTO[] = [];
    const dataStorage = {
      fetchFacesForFiles: async () => [],
      fetchFaceDetectionStatuses: async () => [],
      fetchAllPeople: async () => {
        fetchAllPeopleCallCount += 1;
        const isFirstCall = fetchAllPeopleCallCount === 1;
        await new Promise((r) => setTimeout(r, isFirstCall ? 20 : 0));
        return [];
      },
      saveFaceDetectionResult: async (
        _status: FaceDetectionStatusDTO,
        faces: FaceDTO[],
        newPeople: PersonDTO[],
      ) => {
        savedFaces.push(...faces);
        savedPeople.push(...newPeople);
      },
    };
    const detectForFile = async () => [
      { boundingBox: { x: 0, y: 0, width: 0.1, height: 0.1 }, descriptor: sharedDescriptor },
    ];
    const store = new FaceDetectionStore(dataStorage as any, detectForFile);

    await store.enqueueFiles([
      { id: 'f1', absolutePath: '/a.jpg', dateLastIndexed: new Date() },
      { id: 'f2', absolutePath: '/b.jpg', dateLastIndexed: new Date() },
      { id: 'f3', absolutePath: '/c.jpg', dateLastIndexed: new Date() },
    ]);

    expect(fetchAllPeopleCallCount).toBe(1); // all 3 concurrent runners shared one fetch
    // Exactly one person created, not up to 3 (each file's save references it)
    expect(new Set(savedPeople.map((p) => p.id)).size).toBe(1);
    expect(new Set(savedFaces.map((f) => f.personId)).size).toBe(1);
  });

  it('retries fetchAllPeople on a later call after a transient failure, instead of staying permanently broken', async () => {
    // Regression test: a naive fix that memoizes the fetchAllPeople promise but never resets it on
    // rejection would leave every future call awaiting the same already-rejected promise forever,
    // so face detection would work for zero files ever again after one transient DB error.
    let shouldFail = true;
    const dataStorage = {
      fetchFacesForFiles: async () => [],
      fetchFaceDetectionStatuses: async () => [],
      fetchAllPeople: async () => {
        if (shouldFail) {
          throw new Error('transient DB error');
        }
        return [];
      },
      saveFaceDetectionResult: async (
        _status: FaceDetectionStatusDTO,
        _faces: FaceDTO[],
        _newPeople: PersonDTO[],
      ) => {},
    };
    const detectForFile = async () => [
      { boundingBox: { x: 0, y: 0, width: 0.1, height: 0.1 }, descriptor: new Array(128).fill(0.4) },
    ];
    const store = new FaceDetectionStore(dataStorage as any, detectForFile);

    // First file: fetchAllPeople rejects. Caught and logged per-file; doesn't stall the queue.
    await store.enqueueFiles([{ id: 'f1', absolutePath: '/a.jpg', dateLastIndexed: new Date() }]);
    expect(store.processedCount).toBe(1);
    expect(store.isRunning).toBe(false);

    // fetchAllPeople now works again (e.g. the transient error cleared).
    shouldFail = false;
    const savedPeople: PersonDTO[] = [];
    const savedFaces: FaceDTO[] = [];
    dataStorage.saveFaceDetectionResult = async (
      _status: FaceDetectionStatusDTO,
      faces: FaceDTO[],
      newPeople: PersonDTO[],
    ) => {
      savedFaces.push(...faces);
      savedPeople.push(...newPeople);
    };

    // A later file must succeed, not immediately re-throw the earlier rejection.
    await store.enqueueFiles([{ id: 'f2', absolutePath: '/b.jpg', dateLastIndexed: new Date() }]);

    // processedCount restarts at 0 for this fresh run (isRunning was false after the first drain).
    expect(store.processedCount).toBe(1);
    expect(savedPeople).toHaveLength(1);
    expect(savedFaces).toHaveLength(1);
    expect(savedFaces[0].personId).toBe(savedPeople[0].id);
  });

  it('re-sends a cached person the backend has since pruned, so the save recreates it instead of orphaning the face', async () => {
    const storage = createFakeStorage();
    const descriptor = new Array(128).fill(0.5);
    const store = new FaceDetectionStore(storage, async () => [
      { boundingBox: { x: 0, y: 0, width: 0.1, height: 0.1 }, descriptor },
    ]);
    await store.enqueueFiles([file('a')]);
    expect(storage.people).toHaveLength(1);
    const personId = storage.people[0].id;

    // The backend prunes the person on its own (e.g. file 'a' was removed); the store's cache
    // still holds them.
    storage.faces.splice(0);
    storage.people.splice(0);

    await store.enqueueFiles([file('b')]);
    expect(storage.faces).toHaveLength(1);
    expect(storage.faces[0].personId).toBe(personId);
    expect(storage.people.map((p) => p.id)).toEqual([personId]);
  });

  it('a person created for a file whose save failed is still persisted by the next matching face', async () => {
    const storage = createFakeStorage();
    const save = storage.saveFaceDetectionResult;
    storage.saveFaceDetectionResult = async (status, faces, people) => {
      if (status.fileId === 'a') {
        throw new Error('transient DB error');
      }
      return save(status, faces, people);
    };
    const descriptor = new Array(128).fill(0.6);
    const store = new FaceDetectionStore(storage, async () => [
      { boundingBox: { x: 0, y: 0, width: 0.1, height: 0.1 }, descriptor },
    ]);

    // 'a' creates a new person in the cache, then its save throws: nothing reaches storage.
    await store.enqueueFiles([file('a')]);
    expect(storage.people).toHaveLength(0);

    // 'b' matches that cached-but-never-saved person; its save must create the person row too.
    await store.enqueueFiles([file('b')]);
    expect(storage.faces).toHaveLength(1);
    expect(storage.people).toHaveLength(1);
    expect(storage.faces[0].personId).toBe(storage.people[0].id);
  });
});
