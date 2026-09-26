import crypto from 'crypto';
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
 *
 * The migration is written to a private temp file and only published at
 * `targetContextPath` once complete, so no other reader ever sees a half-migrated
 * context. Publishing never overwrites an existing target: if two migrations race
 * (e.g. two renderer processes on first launch), the first to publish wins and the
 * other discards its own copy and returns false. Overwriting would be unsafe, since
 * the winner may already have the published file open.
 *
 * @returns true if this call published the migrated context file.
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

  // pid alone is not unique: two migrations can run concurrently in the same process.
  const tempPath = `${targetContextPath}.tmp-${process.pid}-${crypto
    .randomBytes(6)
    .toString('hex')}`;

  try {
    const target = await SqliteBackend.init(tempPath, () => {});
    try {
      for (const tag of tags) {
        // Upsert rather than insert: SqliteBackend.init already seeded an empty root tag, and the
        // legacy root carries the real subTags list that the whole tag tree hangs off of.
        await target.saveTag(tag);
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
    } finally {
      // Folds the WAL into the temp file and removes its sidecars, so the published file is
      // self-contained.
      target.close();
    }

    return publishWithoutOverwrite(tempPath, targetContextPath);
  } finally {
    removeQuietly(tempPath);
    removeQuietly(`${tempPath}-wal`);
    removeQuietly(`${tempPath}-shm`);
  }
}

/**
 * Atomically makes `tempPath`'s contents available at `targetPath` unless `targetPath` already
 * exists. A hard link fails with EEXIST instead of replacing an existing target, which a rename
 * would silently do. Filesystems without hard links (e.g. FAT/exFAT) fall back to a rename guarded
 * by an existence check, which is only racy in a much narrower window.
 */
function publishWithoutOverwrite(tempPath: string, targetPath: string): boolean {
  try {
    fs.linkSync(tempPath, targetPath);
    return true;
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'EEXIST') {
      return false;
    }
    if (fs.existsSync(targetPath)) {
      return false;
    }
    fs.renameSync(tempPath, targetPath);
    return true;
  }
}

function removeQuietly(filePath: string): void {
  try {
    fs.rmSync(filePath, { force: true });
  } catch (e) {
    console.warn('Could not remove temporary migration file', filePath, e);
  }
}
