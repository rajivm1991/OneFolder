import fs from 'fs';
import Backend from './backend';
import { dbInit } from './config';
import { OrderDirection } from '../api/data-storage-search';
import { LocationDTO } from '../api/location';
import { SqliteBackend } from './sqlite-backend';

/**
 * One-time translation of the legacy Dexie/IndexedDB database into a new SQLite
 * context file. Never deletes or modifies the source Dexie database. Safe to
 * call more than once — if `targetContextPath` already exists, this is a no-op.
 */
export async function migrateDexieToSqlite(
  dexieDbName: string,
  targetContextPath: string,
): Promise<boolean> {
  if (fs.existsSync(targetContextPath)) {
    return false;
  }

  const legacyDb = dbInit(dexieDbName);
  const legacy = await Backend.init(legacyDb, () => {});

  const [tags, locations, searches, files, dismissedGroups] = await Promise.all([
    legacy.fetchTags(),
    // Note: legacy.fetchLocations() orders by the `dateAdded` Date-typed index,
    // which some IndexedDB implementations (e.g. fake-indexeddb, used in tests)
    // fail to return results for. Read the table directly instead — order does
    // not matter for a one-time migration.
    legacyDb.table('locations').toArray() as Promise<LocationDTO[]>,
    legacy.fetchSearches(),
    legacy.fetchFiles('id', OrderDirection.Asc),
    legacy.fetchDismissedDuplicateGroups(),
  ]);

  const target = await SqliteBackend.init(targetContextPath, () => {});

  for (const tag of tags) {
    // Backend.init already seeded a root tag into the fresh SQLite file, so skip it here.
    if (tag.id === 'root') {
      continue;
    }
    await target.createTag(tag);
  }
  for (const location of locations) {
    await target.createLocation(location);
  }
  for (const search of searches) {
    await target.createSearch(search);
  }
  if (files.length > 0) {
    await target.saveFiles(files);
  }
  for (const group of dismissedGroups) {
    await target.createDismissedDuplicateGroup(group);
  }

  return true;
}
