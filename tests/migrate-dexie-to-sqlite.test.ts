import fse from 'fs-extra';
import os from 'os';
import path from 'path';
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

  it('is a no-op if the target context file already exists', async () => {
    const dexieDbName = `MigrateTest_${counter++}`;
    dbInit(dexieDbName);
    const targetPath = path.join(tmpDir, 'default.onefolder');
    await fse.ensureFile(targetPath);
    const migrated = await migrateDexieToSqlite(dexieDbName, targetPath);
    expect(migrated).toBe(false);
  });
});
