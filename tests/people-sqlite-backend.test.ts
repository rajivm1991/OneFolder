import fse from 'fs-extra';
import os from 'os';
import path from 'path';
import { FaceDetectionStatusDTO, FaceDTO } from '../src/api/face';
import { FileDTO } from '../src/api/file';
import { PersonDTO } from '../src/api/person';
import { SqliteBackend } from '../src/backend/sqlite-backend';

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
});
