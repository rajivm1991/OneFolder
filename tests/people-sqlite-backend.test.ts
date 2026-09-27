import fse from 'fs-extra';
import os from 'os';
import path from 'path';
import { FaceDetectionStatusDTO, FaceDTO } from '../src/api/face';
import { FileDTO } from '../src/api/file';
import { PersonDTO } from '../src/api/person';
import { SqliteBackend } from '../src/backend/sqlite-backend';
import { FaceDetectionStore } from '../src/frontend/stores/FaceDetectionStore';

describe('SqliteBackend people / face clustering API', () => {
  let tmpDir: string;
  let counter = 0;

  beforeEach(async () => {
    tmpDir = await fse.mkdtemp(path.join(os.tmpdir(), 'onefolder-sqlite-people-'));
  });

  afterEach(async () => {
    await fse.remove(tmpDir);
  });

  function test(name: string, testFn: (backend: SqliteBackend) => Promise<void>) {
    it(name, async () => {
      const contextPath = path.join(tmpDir, `context-${counter++}.onefolder`);
      const backend = await SqliteBackend.init(contextPath, () => {});
      await testFn(backend);
    });
  }

  function mockPerson(overrides: Partial<PersonDTO> = {}): PersonDTO {
    return {
      id: 'person-1',
      name: '',
      representativeDescriptor: new Array(128).fill(0.1),
      dateCreated: new Date('2026-09-27T00:00:00.000Z'),
      ...overrides,
    };
  }

  function mockFace(overrides: Partial<FaceDTO> = {}): FaceDTO {
    return {
      id: 'face-1',
      fileId: 'file-1',
      boundingBox: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
      descriptor: new Array(128).fill(0.1),
      personId: 'person-1',
      dateDetected: new Date('2026-09-27T00:00:00.000Z'),
      ...overrides,
    };
  }

  function mockStatus(overrides: Partial<FaceDetectionStatusDTO> = {}): FaceDetectionStatusDTO {
    return {
      fileId: 'file-1',
      status: 'done',
      dateDetected: new Date('2026-09-27T00:00:00.000Z'),
      ...overrides,
    };
  }

  // faces.file_id has a real FOREIGN KEY REFERENCES files(id) in SQLite (unlike the Dexie
  // backend), so tests need a real file row to exist before inserting a face for it.
  function mockFile(overrides: Partial<FileDTO> = {}): FileDTO {
    const id = overrides.id ?? 'file-1';
    return {
      id,
      ino: `ino-${id}`,
      locationId: 'loc1',
      relativePath: `${id}.jpg`,
      absolutePath: `/root/${id}.jpg`,
      tags: [],
      dateAdded: new Date(),
      dateModified: new Date(),
      dateLastIndexed: new Date(),
      name: id,
      extension: 'jpg',
      size: 100,
      width: 10,
      height: 10,
      dateCreated: new Date(),
      annotations: '{}',
      lat: undefined,
      lng: undefined,
      ...overrides,
    };
  }

  test('saveFaceDetectionResult with newPeople creates the person atomically with its face', async (backend) => {
    await backend.createFilesFromPath('/root', [mockFile({ id: 'file-1' })]);
    const person = mockPerson();
    const face = mockFace({ personId: person.id });
    await backend.saveFaceDetectionResult(mockStatus(), [face], [person]);

    const people = await backend.fetchAllPeople();
    expect(people).toEqual([person]);
    const faces = await backend.fetchFacesForFile('file-1');
    expect(faces).toEqual([face]);
  });

  test('a second face assigned to an already-created person does not duplicate the person', async (backend) => {
    await backend.createFilesFromPath('/root', [
      mockFile({ id: 'file-1' }),
      mockFile({ id: 'file-2' }),
    ]);
    const person = mockPerson();
    await backend.saveFaceDetectionResult(
      mockStatus({ fileId: 'file-1' }),
      [mockFace({ id: 'face-1', fileId: 'file-1', personId: person.id })],
      [person],
    );
    // second file, same person, no newPeople this time (already exists)
    await backend.saveFaceDetectionResult(
      mockStatus({ fileId: 'file-2' }),
      [mockFace({ id: 'face-2', fileId: 'file-2', personId: person.id })],
      [],
    );

    const people = await backend.fetchAllPeople();
    expect(people).toHaveLength(1);
  });

  test('renamePerson updates the name, and can be called again to change or clear it', async (backend) => {
    await backend.createFilesFromPath('/root', [mockFile({ id: 'file-1' })]);
    const person = mockPerson({ name: '' });
    await backend.saveFaceDetectionResult(mockStatus(), [mockFace({ personId: person.id })], [
      person,
    ]);
    await backend.renamePerson(person.id, 'Mom');
    expect((await backend.fetchAllPeople())[0].name).toBe('Mom');

    // Renaming again overwrites, not appends or errors
    await backend.renamePerson(person.id, 'Mother');
    expect((await backend.fetchAllPeople())[0].name).toBe('Mother');

    // Clearing back to '' is valid — the UI treats '' as "Unnamed"
    await backend.renamePerson(person.id, '');
    expect((await backend.fetchAllPeople())[0].name).toBe('');
  });

  test('re-detecting a file with different results prunes a person left with zero faces', async (backend) => {
    await backend.createFilesFromPath('/root', [mockFile({ id: 'file-1' })]);
    const person = mockPerson({ id: 'person-solo' });
    await backend.saveFaceDetectionResult(
      mockStatus({ fileId: 'file-1' }),
      [mockFace({ id: 'face-1', fileId: 'file-1', personId: person.id })],
      [person],
    );
    expect(await backend.fetchAllPeople()).toHaveLength(1);

    // Re-detect file-1: this time it has 0 faces. person-solo now has 0 faces anywhere and
    // must be pruned.
    await backend.saveFaceDetectionResult(mockStatus({ fileId: 'file-1' }), [], []);
    expect(await backend.fetchAllPeople()).toHaveLength(0);
  });

  test('removeFiles prunes a person left with zero faces', async (backend) => {
    const person = mockPerson({ id: 'person-solo' });
    await backend.createFilesFromPath('/root', [mockFile({ id: 'file-1' })]);
    await backend.saveFaceDetectionResult(
      mockStatus({ fileId: 'file-1' }),
      [mockFace({ id: 'face-1', fileId: 'file-1', personId: person.id })],
      [person],
    );
    expect(await backend.fetchAllPeople()).toHaveLength(1);

    await backend.removeFiles(['file-1']);
    expect(await backend.fetchAllPeople()).toHaveLength(0);
  });

  test('saveFaceDetectionResult recreates a referenced person that has no row (e.g. pruned meanwhile)', async (backend) => {
    await backend.createFilesFromPath('/root', [mockFile({ id: 'file-2' })]);
    const person = mockPerson({ id: 'person-pruned', name: 'Mom' });
    await backend.saveFaceDetectionResult(
      mockStatus({ fileId: 'file-2' }),
      [mockFace({ id: 'face-2', fileId: 'file-2', personId: person.id })],
      [person],
    );
    expect(await backend.fetchAllPeople()).toEqual([person]);
    expect((await backend.fetchFacesForFile('file-2'))[0].personId).toBe(person.id);
  });

  test('saveFaceDetectionResult leaves an existing person row untouched (no rename reverted, no duplicate)', async (backend) => {
    await backend.createFilesFromPath('/root', [
      mockFile({ id: 'file-1' }),
      mockFile({ id: 'file-2' }),
    ]);
    const person = mockPerson();
    await backend.saveFaceDetectionResult(
      mockStatus({ fileId: 'file-1' }),
      [mockFace({ id: 'face-1', fileId: 'file-1', personId: person.id })],
      [person],
    );
    await backend.renamePerson(person.id, 'Mom');
    // A stale copy (still named '') is passed again, twice in the same call.
    await backend.saveFaceDetectionResult(
      mockStatus({ fileId: 'file-2' }),
      [
        mockFace({ id: 'face-2', fileId: 'file-2', personId: person.id }),
        mockFace({ id: 'face-3', fileId: 'file-2', personId: person.id }),
      ],
      [person, person],
    );
    const people = await backend.fetchAllPeople();
    expect(people).toHaveLength(1);
    expect(people[0].name).toBe('Mom');
  });

  /** End-to-end with the REAL store + REAL SQLite backend: the store's in-memory people cache is
   * never refreshed, so it can reference people the backend has pruned (or never saved). */
  const box = { x: 0.1, y: 0.1, width: 0.2, height: 0.2 };
  const descriptorA = new Array(128).fill(0.1);
  const descriptorANearby = [0.15, ...new Array(127).fill(0.1)]; // distance 0.05 < 0.6
  const detect = async (absolutePath: string) => [
    { boundingBox: box, descriptor: absolutePath.includes('file-1') ? descriptorA : descriptorANearby },
  ];
  const forDetection = (id: string) => ({
    id,
    absolutePath: `/root/${id}.jpg`,
    dateLastIndexed: new Date(),
  });

  test('store + backend: a person pruned by removeFiles is recreated when a new face matches them', async (backend) => {
    await backend.createFilesFromPath('/root', [
      mockFile({ id: 'file-1' }),
      mockFile({ id: 'file-2' }),
    ]);
    const store = new FaceDetectionStore(backend, detect);

    await store.enqueueFiles([forDetection('file-1')]);
    const [person] = await backend.fetchAllPeople();
    expect(person).toBeDefined();
    await store.renamePerson(person.id, 'Mom');

    // Their only photo is removed: the backend prunes them, but the store's cache still has them.
    await backend.removeFiles(['file-1']);
    expect(await backend.fetchAllPeople()).toHaveLength(0);

    await store.enqueueFiles([forDetection('file-2')]);
    const faces = await backend.fetchFacesForFile('file-2');
    expect(faces).toHaveLength(1);
    expect(faces[0].personId).toBe(person.id);
    // The person row exists again (same id, name kept), so the face is visible in the People view.
    const people = await backend.fetchAllPeople();
    expect(people.map((p) => [p.id, p.name])).toEqual([[person.id, 'Mom']]);
  });

  test('store + backend: a person first created for a file whose save failed is persisted by a later match', async (backend) => {
    await backend.createFilesFromPath('/root', [
      mockFile({ id: 'file-1' }),
      mockFile({ id: 'file-2' }),
    ]);
    const storage = {
      fetchFacesForFiles: (ids: string[]) => backend.fetchFacesForFiles(ids),
      fetchFaceDetectionStatuses: (ids: string[]) => backend.fetchFaceDetectionStatuses(ids),
      fetchAllPeople: () => backend.fetchAllPeople(),
      renamePerson: (id: string, name: string) => backend.renamePerson(id, name),
      saveFaceDetectionResult: async (
        status: FaceDetectionStatusDTO,
        faces: FaceDTO[],
        people: PersonDTO[],
      ) => {
        if (status.fileId === 'file-1') {
          throw new Error('transient DB error');
        }
        return backend.saveFaceDetectionResult(status, faces, people);
      },
    };
    const store = new FaceDetectionStore(storage, detect);

    await store.enqueueFiles([forDetection('file-1')]); // person created in cache, save throws
    expect(await backend.fetchAllPeople()).toHaveLength(0);

    await store.enqueueFiles([forDetection('file-2')]);
    const faces = await backend.fetchFacesForFile('file-2');
    const people = await backend.fetchAllPeople();
    expect(faces).toHaveLength(1);
    expect(people).toHaveLength(1);
    expect(faces[0].personId).toBe(people[0].id);
  });
});
