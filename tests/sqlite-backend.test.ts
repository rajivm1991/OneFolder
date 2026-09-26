import fse from 'fs-extra';
import os from 'os';
import path from 'path';
import { ROOT_TAG_ID, TagDTO } from '../src/api/tag';
import { LocationDTO } from '../src/api/location';
import { FileSearchDTO } from '../src/api/file-search';
import { SqliteBackend } from '../src/backend/sqlite-backend';

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
});
