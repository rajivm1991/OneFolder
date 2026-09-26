import fse from 'fs-extra';
import os from 'os';
import path from 'path';
import { ROOT_TAG_ID } from '../src/api/tag';
import { dbInit } from '../src/backend/config';
import Backend from '../src/backend/backend';
import { SqliteBackend } from '../src/backend/sqlite-backend';
import { migrateDexieToSqlite } from '../src/backend/migrate-dexie-to-sqlite';

describe('migrateDexieToSqlite', () => {
  let tmpDir: string;
  let counter = 0;

  beforeEach(async () => {
    tmpDir = await fse.mkdtemp(path.join(os.tmpdir(), 'onefolder-migrate-'));
  });

  afterEach(async () => {
    await fse.remove(tmpDir);
  });

  it('copies tags, locations and files from the Dexie DB into a new SQLite context file', async () => {
    const dexieDbName = `MigrateTest_${counter++}`;
    const db = dbInit(dexieDbName);
    const legacy = await Backend.init(db, () => {});
    await legacy.createTag({
      id: 'tag1',
      name: 'Favorite',
      dateAdded: new Date(),
      color: '',
      subTags: [],
      isHidden: false,
    });
    await legacy.createLocation({
      id: 'loc1',
      path: '/old/library',
      dateAdded: new Date(),
      subLocations: [],
      index: 0,
    });
    await legacy.createFilesFromPath('/old/library', [
      {
        id: 'f1',
        ino: '1',
        locationId: 'loc1',
        relativePath: 'a.jpg',
        absolutePath: '/old/library/a.jpg',
        name: 'a.jpg',
        extension: 'jpg',
        size: 1,
        width: 1,
        height: 1,
        dateAdded: new Date(),
        dateModified: new Date(),
        dateCreated: new Date(),
        dateLastIndexed: new Date(),
        annotations: '',
        lat: undefined,
        lng: undefined,
        tags: ['tag1'],
      },
    ]);

    const targetPath = path.join(tmpDir, 'default.onefolder');
    const migrated = await migrateDexieToSqlite(dexieDbName, targetPath);
    expect(migrated).toBe(true);

    const sqlite = await SqliteBackend.init(targetPath, () => {});
    const tags = await sqlite.fetchTags();
    expect(tags.map((t) => t.id).sort()).toEqual(['root', 'tag1']);
    expect(await sqlite.fetchLocations()).toHaveLength(1);
    const files = await sqlite.fetchFiles('id' as any, 0);
    expect(files).toHaveLength(1);
    expect(files[0].tags).toEqual(['tag1']);
  });

  it("carries the legacy root tag's subTags across, so the migrated tag tree is not empty", async () => {
    const dexieDbName = `MigrateTest_${counter++}`;
    const db = dbInit(dexieDbName);
    const legacy = await Backend.init(db, () => {});
    await legacy.createTag({
      id: 'tag1',
      name: 'Favorite',
      dateAdded: new Date(),
      color: '',
      subTags: [],
      isHidden: false,
    });
    const legacyRoot = (await legacy.fetchTags()).find((t) => t.id === ROOT_TAG_ID);
    expect(legacyRoot).toBeDefined();
    await legacy.saveTag({ ...legacyRoot!, subTags: ['tag1'] });

    const targetPath = path.join(tmpDir, 'default.onefolder');
    await migrateDexieToSqlite(dexieDbName, targetPath);

    const sqlite = await SqliteBackend.init(targetPath, () => {});
    const root = (await sqlite.fetchTags()).find((t) => t.id === ROOT_TAG_ID);
    expect(root?.subTags).toEqual(['tag1']);
  });

  it('is a no-op if the target context file already exists', async () => {
    const dexieDbName = `MigrateTest_${counter++}`;
    dbInit(dexieDbName);
    const targetPath = path.join(tmpDir, 'default.onefolder');
    await fse.ensureFile(targetPath);
    const migrated = await migrateDexieToSqlite(dexieDbName, targetPath);
    expect(migrated).toBe(false);
  });
});
