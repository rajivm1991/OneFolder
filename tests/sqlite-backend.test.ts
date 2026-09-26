import fse from 'fs-extra';
import os from 'os';
import path from 'path';
import { ROOT_TAG_ID, TagDTO } from '../src/api/tag';
import { LocationDTO } from '../src/api/location';
import { FileSearchDTO } from '../src/api/file-search';
import { SqliteBackend } from '../src/backend/sqlite-backend';
import { OrderDirection } from '../src/api/data-storage-search';
import { FileDTO } from '../src/api/file';

describe('SqliteBackend', () => {
  let tmpDir: string;
  let counter = 0;

  beforeEach(async () => {
    tmpDir = await fse.mkdtemp(path.join(os.tmpdir(), 'onefolder-sqlite-'));
  });

  afterEach(async () => {
    await fse.remove(tmpDir);
  });

  async function initBackend(): Promise<SqliteBackend> {
    const contextPath = path.join(tmpDir, `context-${counter++}.onefolder`);
    return SqliteBackend.init(contextPath, () => {});
  }

  const mockTag: TagDTO = {
    id: 'tag1',
    name: 'tag1 name',
    dateAdded: new Date(),
    color: '',
    subTags: [],
    isHidden: false,
  };

  it('seeds a root tag on first init', async () => {
    const backend = await initBackend();
    const tags = await backend.fetchTags();
    expect(tags).toHaveLength(1);
    expect(tags[0].id).toBe(ROOT_TAG_ID);
  });

  it('does not duplicate the root tag when re-initialized against the same file', async () => {
    const contextPath = path.join(tmpDir, 'reinit.onefolder');
    await SqliteBackend.init(contextPath, () => {});
    const backend2 = await SqliteBackend.init(contextPath, () => {});
    const tags = await backend2.fetchTags();
    expect(tags).toHaveLength(1);
  });

  it('creates and fetches a tag', async () => {
    const backend = await initBackend();
    await backend.createTag(mockTag);
    const tags = await backend.fetchTags();
    expect(tags.map((t: TagDTO) => t.id).sort()).toEqual([ROOT_TAG_ID, 'tag1'].sort());
  });

  it('saveTag updates an existing tag in place', async () => {
    const backend = await initBackend();
    await backend.createTag(mockTag);
    await backend.saveTag({ ...mockTag, name: 'renamed' });
    const tags = await backend.fetchTags();
    expect(tags.find((t: TagDTO) => t.id === 'tag1')?.name).toBe('renamed');
  });

  it('creates, fetches, saves and removes a location', async () => {
    const backend = await initBackend();
    const location: LocationDTO = {
      id: 'loc1',
      path: '/drives/school',
      dateAdded: new Date(),
      subLocations: [],
      index: 0,
    };
    await backend.createLocation(location);
    expect(await backend.fetchLocations()).toHaveLength(1);
    await backend.saveLocation({ ...location, path: '/drives/school-renamed' });
    expect((await backend.fetchLocations())[0].path).toBe('/drives/school-renamed');
    await backend.removeLocation('loc1');
    expect(await backend.fetchLocations()).toHaveLength(0);
  });

  it('creates, fetches, saves and removes a search', async () => {
    const backend = await initBackend();
    const search: FileSearchDTO = { id: 's1', name: 'Favorites', criteria: [], index: 0 };
    await backend.createSearch(search);
    expect(await backend.fetchSearches()).toHaveLength(1);
    await backend.saveSearch({ ...search, name: 'Renamed' });
    expect((await backend.fetchSearches())[0].name).toBe('Renamed');
    await backend.removeSearch('s1');
    expect(await backend.fetchSearches()).toHaveLength(0);
  });

  it('two contexts have fully isolated tag sets', async () => {
    const backendA = await initBackend();
    const backendB = await initBackend();
    await backendA.createTag(mockTag);
    expect(await backendA.fetchTags()).toHaveLength(2); // root + mockTag
    expect(await backendB.fetchTags()).toHaveLength(1); // root only
  });

  it('rejects opening a non-empty file that is not a OneFolder context', async () => {
    const foreignPath = path.join(tmpDir, 'not-a-context.onefolder');
    const foreignDb = new (require('better-sqlite3'))(foreignPath);
    foreignDb.exec('CREATE TABLE unrelated_stuff (id TEXT)');
    foreignDb.close();

    await expect(SqliteBackend.init(foreignPath, () => {})).rejects.toThrow(
      /not a OneFolder context file/,
    );
  });

  function createMockFile(overrides: Partial<FileDTO> = {}): FileDTO {
    return {
      id: overrides.id ?? 'file1',
      ino: '1',
      locationId: 'loc1',
      relativePath: 'a.jpg',
      absolutePath: overrides.absolutePath ?? '/drives/school/a.jpg',
      name: 'a.jpg',
      extension: 'jpg',
      size: 42,
      width: 640,
      height: 480,
      dateAdded: new Date(),
      dateModified: new Date(),
      dateCreated: new Date(),
      dateLastIndexed: new Date(),
      annotations: '',
      lat: undefined,
      lng: undefined,
      tags: [],
      ...overrides,
    };
  }

  it('createFilesFromPath then fetchFiles round-trips a file, including tags', async () => {
    const backend = await initBackend();
    await backend.createTag(mockTag);
    const file = createMockFile({ tags: ['tag1'] });
    await backend.createFilesFromPath('/drives/school', [file]);
    const files = await backend.fetchFiles('id', OrderDirection.Asc);
    expect(files).toHaveLength(1);
    expect(files[0].absolutePath).toBe(file.absolutePath);
    expect(files[0].tags).toEqual(['tag1']);
  });

  it('createFilesFromPath skips files whose absolutePath already exists under that path', async () => {
    const backend = await initBackend();
    const file = createMockFile();
    await backend.createFilesFromPath('/drives/school', [file]);
    await backend.createFilesFromPath('/drives/school', [file]);
    expect(await backend.fetchFiles('id', OrderDirection.Asc)).toHaveLength(1);
  });

  it('fetchFilesByID returns only existing ids, in no particular guaranteed order', async () => {
    const backend = await initBackend();
    await backend.createFilesFromPath('/drives/school', [
      createMockFile({ id: 'f1', absolutePath: '/drives/school/f1.jpg' }),
      createMockFile({ id: 'f2', absolutePath: '/drives/school/f2.jpg' }),
    ]);
    const files = await backend.fetchFilesByID(['f1', 'missing', 'f2']);
    expect(files.map((f) => f.id).sort()).toEqual(['f1', 'f2']);
  });

  it('fetchFilesByKey filters by an exact field match', async () => {
    const backend = await initBackend();
    await backend.createFilesFromPath('/drives/school', [
      createMockFile({ id: 'f1', absolutePath: '/drives/school/f1.jpg', locationId: 'locA' }),
      createMockFile({ id: 'f2', absolutePath: '/drives/school/f2.jpg', locationId: 'locB' }),
    ]);
    const files = await backend.fetchFilesByKey('locationId', 'locA');
    expect(files.map((f) => f.id)).toEqual(['f1']);
  });

  it('searchFiles supports a string "contains" condition (AND semantics)', async () => {
    const backend = await initBackend();
    await backend.createFilesFromPath('/drives/school', [
      createMockFile({ id: 'f1', absolutePath: '/drives/school/holiday.jpg', name: 'holiday.jpg' }),
      createMockFile({ id: 'f2', absolutePath: '/drives/school/exam.jpg', name: 'exam.jpg' }),
    ]);
    const results = await backend.searchFiles(
      { key: 'name', operator: 'contains', value: 'holiday', valueType: 'string' },
      'id',
      OrderDirection.Asc,
    );
    expect(results.map((f) => f.id)).toEqual(['f1']);
  });

  it('searchFiles supports an array "contains" condition for tags, with OR semantics across two conditions', async () => {
    const backend = await initBackend();
    await backend.createTag(mockTag);
    await backend.createTag({ ...mockTag, id: 'tag2' });
    await backend.createFilesFromPath('/drives/school', [
      createMockFile({ id: 'f1', absolutePath: '/drives/school/f1.jpg', tags: ['tag1'] }),
      createMockFile({ id: 'f2', absolutePath: '/drives/school/f2.jpg', tags: ['tag2'] }),
      createMockFile({ id: 'f3', absolutePath: '/drives/school/f3.jpg', tags: [] }),
    ]);
    const results = await backend.searchFiles(
      [
        { key: 'tags', operator: 'contains', value: ['tag1'], valueType: 'array' },
        { key: 'tags', operator: 'contains', value: ['tag2'], valueType: 'array' },
      ],
      'id',
      OrderDirection.Asc,
      true,
    );
    expect(results.map((f) => f.id).sort()).toEqual(['f1', 'f2']);
  });

  it('removeFiles deletes the given files', async () => {
    const backend = await initBackend();
    await backend.createFilesFromPath('/drives/school', [
      createMockFile({ id: 'f1', absolutePath: '/drives/school/f1.jpg' }),
    ]);
    await backend.removeFiles(['f1']);
    expect(await backend.fetchFiles('id', OrderDirection.Asc)).toHaveLength(0);
  });

  it('saveFiles persists lat/lng fields', async () => {
    const backend = await initBackend();
    await backend.createFilesFromPath('/drives/school', [
      createMockFile({ id: 'f1', absolutePath: '/drives/school/f1.jpg' }),
    ]);
    const [file] = await backend.fetchFilesByID(['f1']);
    await backend.saveFiles([{ ...file, lat: 48.8566, lng: 2.3522 }]);
    const [saved] = await backend.fetchFilesByID(['f1']);
    expect(saved.lat).toBe(48.8566);
    expect(saved.lng).toBe(2.3522);
  });

  it('createFilesFromPath escapes LIKE metacharacters in the path when detecting duplicates', async () => {
    const backend = await initBackend();
    const file = createMockFile({
      id: 'f1',
      absolutePath: '/drives/100%folder/f1.jpg',
    });
    await backend.createFilesFromPath('/drives/100%folder', [file]);
    await backend.createFilesFromPath('/drives/100%folder', [file]);
    expect(await backend.fetchFiles('id', OrderDirection.Asc)).toHaveLength(1);
  });

  it('createFilesFromPath does not over-match unrelated paths due to unescaped % wildcard', async () => {
    const backend = await initBackend();
    await backend.createFilesFromPath('/drives/100Xfolder', [
      createMockFile({ id: 'f1', absolutePath: '/drives/100Xfolder/f1.jpg' }),
    ]);
    await backend.createFilesFromPath('/drives/100%folder', [
      createMockFile({ id: 'f2', absolutePath: '/drives/100%folder/f2.jpg' }),
    ]);
    const files = await backend.fetchFiles('id', OrderDirection.Asc);
    expect(files.map((f) => f.id).sort()).toEqual(['f1', 'f2']);
  });
});
