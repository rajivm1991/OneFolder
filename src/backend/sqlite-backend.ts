import Database from 'better-sqlite3';
import fs from 'fs';

import { shuffleArray } from '../../common/core';
import { ConditionDTO, OrderBy, OrderDirection } from '../api/data-storage-search';
import { DismissedDuplicateGroupDTO } from '../api/dismissed-duplicate-group';
import { FaceDetectionStatusDTO, FaceDTO } from '../api/face';
import { FileDTO } from '../api/file';
import { generateId, ID } from '../api/id';
import { LocationDTO } from '../api/location';
import { FileSearchDTO } from '../api/file-search';
import { ROOT_TAG_ID, TagDTO } from '../api/tag';
import { VisualHashDTO } from '../api/visual-hash';
import { DataStorage } from '../api/data-storage';
import { filterLambda } from './backend';
import { initSqliteSchema } from './sqlite-schema';

type TagRow = {
  id: string;
  name: string;
  dateAdded: string;
  color: string;
  isHidden: number;
};

/**
 * FileDTO.lat/lng are three-state: undefined = GPS not yet checked, null = checked and none found,
 * number = coordinate. A REAL column only holds null/number, so a separate *Checked column keeps
 * the distinction. Rows from older context files have no checked flag (NULL): if they also have
 * no coordinate, treat them as not yet checked so GPS backfill looks at them again, rather than
 * permanently skipping them.
 */
function gpsFromRow(value: number | null, checked: number | null): number | null | undefined {
  if (checked === 0 || (checked === null && value === null)) {
    return undefined;
  }
  return value;
}

function gpsParams(file: FileDTO) {
  return {
    lat: file.lat ?? null,
    lng: file.lng ?? null,
    latChecked: file.lat === undefined ? 0 : 1,
    lngChecked: file.lng === undefined ? 0 : 1,
  };
}

function rowToFaceDTO(row: any): FaceDTO {
  return {
    id: row.id,
    fileId: row.file_id,
    boundingBox: JSON.parse(row.boundingBox),
    descriptor: JSON.parse(row.descriptor),
    personId: row.personId ?? null,
    dateDetected: new Date(row.dateDetected),
  };
}

export class SqliteBackend implements DataStorage {
  #db: Database.Database;
  #notifyChange: () => void;

  private constructor(db: Database.Database, notifyChange: () => void) {
    this.#db = db;
    this.#notifyChange = notifyChange;
  }

  static async init(contextPath: string, notifyChange: () => void): Promise<SqliteBackend> {
    const isNewFile = !fs.existsSync(contextPath);
    const db = new Database(contextPath);

    if (!isNewFile) {
      // Reject files that aren't empty and aren't already a OneFolder context —
      // never silently graft our schema onto an unrelated SQLite (or non-SQLite) file.
      const existingTables = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as { name: string }[];
      const hasAnyTables = existingTables.length > 0;
      const hasTagsTable = existingTables.some((t) => t.name === 'tags');
      if (hasAnyTables && !hasTagsTable) {
        db.close();
        throw new Error(
          `"${contextPath}" is not a OneFolder context file (unrecognized database schema).`,
        );
      }
    }

    initSqliteSchema(db);
    const backend = new SqliteBackend(db, notifyChange);

    const tagCount = (db.prepare('SELECT COUNT(*) as c FROM tags').get() as { c: number }).c;
    if (tagCount === 0) {
      // OR IGNORE: another connection may have seeded root between the count and this insert.
      db.prepare(
        'INSERT OR IGNORE INTO tags (id, name, dateAdded, color, isHidden) VALUES (?, ?, ?, ?, ?)',
      ).run(ROOT_TAG_ID, 'Root', new Date().toISOString(), '', 0);
    }
    void isNewFile; // reserved for future "new context" telemetry/logging; not branched on today
    return backend;
  }

  #rowToTag(row: TagRow): TagDTO {
    const subTags = this.#db
      .prepare('SELECT sub_tag_id FROM tag_subtags WHERE tag_id = ? ORDER BY position')
      .all(row.id) as { sub_tag_id: string }[];
    return {
      id: row.id,
      name: row.name,
      dateAdded: new Date(row.dateAdded),
      color: row.color,
      isHidden: row.isHidden === 1,
      subTags: subTags.map((r) => r.sub_tag_id),
    };
  }

  async fetchTags(): Promise<TagDTO[]> {
    const rows = this.#db.prepare('SELECT * FROM tags').all() as TagRow[];
    return rows.map((row) => this.#rowToTag(row));
  }

  #writeSubTags(tag: TagDTO): void {
    this.#db.prepare('DELETE FROM tag_subtags WHERE tag_id = ?').run(tag.id);
    const insert = this.#db.prepare(
      'INSERT INTO tag_subtags (tag_id, sub_tag_id, position) VALUES (?, ?, ?)',
    );
    tag.subTags.forEach((subTagId, position) => insert.run(tag.id, subTagId, position));
  }

  async createTag(tag: TagDTO): Promise<void> {
    const insertTag = this.#db.transaction((t: TagDTO) => {
      this.#db
        .prepare('INSERT INTO tags (id, name, dateAdded, color, isHidden) VALUES (?, ?, ?, ?, ?)')
        .run(t.id, t.name, t.dateAdded.toISOString(), t.color, t.isHidden ? 1 : 0);
      this.#writeSubTags(t);
    });
    insertTag(tag);
    this.#notifyChange();
  }

  async saveTag(tag: TagDTO): Promise<void> {
    const upsert = this.#db.transaction((t: TagDTO) => {
      this.#db
        .prepare(
          'INSERT INTO tags (id, name, dateAdded, color, isHidden) VALUES (?, ?, ?, ?, ?) ' +
            'ON CONFLICT(id) DO UPDATE SET name=excluded.name, dateAdded=excluded.dateAdded, color=excluded.color, isHidden=excluded.isHidden',
        )
        .run(t.id, t.name, t.dateAdded.toISOString(), t.color, t.isHidden ? 1 : 0);
      this.#writeSubTags(t);
    });
    upsert(tag);
    this.#notifyChange();
  }

  async removeTags(tags: ID[]): Promise<void> {
    const run = this.#db.transaction((tagIds: ID[]) => {
      const placeholders = tagIds.map(() => '?').join(',');
      this.#db
        .prepare(`DELETE FROM file_tags WHERE tag_id IN (${placeholders})`)
        .run(...tagIds);
      this.#db.prepare(`DELETE FROM tag_subtags WHERE tag_id IN (${placeholders})`).run(...tagIds);
      this.#db
        .prepare(`DELETE FROM tag_subtags WHERE sub_tag_id IN (${placeholders})`)
        .run(...tagIds);
      this.#db.prepare(`DELETE FROM tags WHERE id IN (${placeholders})`).run(...tagIds);
    });
    run(tags);
    this.#notifyChange();
  }

  async mergeTags(tagToBeRemoved: ID, tagToMergeWith: ID): Promise<void> {
    const run = this.#db.transaction((removed: ID, mergeWith: ID) => {
      // Re-point file_tags rows, ignoring ones that would collide with an existing (file, mergeWith) row
      this.#db.prepare(`UPDATE OR IGNORE file_tags SET tag_id = ? WHERE tag_id = ?`).run(
        mergeWith,
        removed,
      );
      this.#db.prepare('DELETE FROM file_tags WHERE tag_id = ?').run(removed);
      this.#db.prepare('DELETE FROM tags WHERE id = ?').run(removed);
    });
    run(tagToBeRemoved, tagToMergeWith);
    this.#notifyChange();
  }

  async fetchLocations(): Promise<LocationDTO[]> {
    const rows = this.#db.prepare('SELECT * FROM locations ORDER BY dateAdded').all() as any[];
    return rows.map((row) => ({
      id: row.id,
      path: row.path,
      dateAdded: new Date(row.dateAdded),
      index: row.index,
      subLocations: JSON.parse(row.subLocations),
    }));
  }

  async createLocation(location: LocationDTO): Promise<void> {
    this.#db
      .prepare(
        'INSERT INTO locations (id, path, dateAdded, "index", subLocations) VALUES (?, ?, ?, ?, ?)',
      )
      .run(
        location.id,
        location.path,
        location.dateAdded.toISOString(),
        location.index,
        JSON.stringify(location.subLocations),
      );
    this.#notifyChange();
  }

  async saveLocation(location: LocationDTO): Promise<void> {
    this.#db
      .prepare(
        'INSERT INTO locations (id, path, dateAdded, "index", subLocations) VALUES (?, ?, ?, ?, ?) ' +
          'ON CONFLICT(id) DO UPDATE SET path=excluded.path, dateAdded=excluded.dateAdded, "index"=excluded."index", subLocations=excluded.subLocations',
      )
      .run(
        location.id,
        location.path,
        location.dateAdded.toISOString(),
        location.index,
        JSON.stringify(location.subLocations),
      );
    this.#notifyChange();
  }

  async removeLocation(location: ID): Promise<void> {
    const run = this.#db.transaction((locationId: ID) => {
      this.#db.prepare('DELETE FROM files WHERE locationId = ?').run(locationId);
      this.#db.prepare('DELETE FROM locations WHERE id = ?').run(locationId);
    });
    run(location);
    this.#notifyChange();
  }

  async fetchSearches(): Promise<FileSearchDTO[]> {
    const rows = this.#db.prepare('SELECT * FROM searches').all() as any[];
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      criteria: JSON.parse(row.criteria),
      matchAny: row.matchAny === null ? undefined : row.matchAny === 1,
      index: row.index,
    }));
  }

  async createSearch(search: FileSearchDTO): Promise<void> {
    this.#db
      .prepare('INSERT INTO searches (id, name, criteria, matchAny, "index") VALUES (?, ?, ?, ?, ?)')
      .run(
        search.id,
        search.name,
        JSON.stringify(search.criteria),
        search.matchAny === undefined ? null : search.matchAny ? 1 : 0,
        search.index,
      );
    this.#notifyChange();
  }

  async saveSearch(search: FileSearchDTO): Promise<void> {
    this.#db
      .prepare(
        'INSERT INTO searches (id, name, criteria, matchAny, "index") VALUES (?, ?, ?, ?, ?) ' +
          'ON CONFLICT(id) DO UPDATE SET name=excluded.name, criteria=excluded.criteria, matchAny=excluded.matchAny, "index"=excluded."index"',
      )
      .run(
        search.id,
        search.name,
        JSON.stringify(search.criteria),
        search.matchAny === undefined ? null : search.matchAny ? 1 : 0,
        search.index,
      );
    this.#notifyChange();
  }

  async removeSearch(search: ID): Promise<void> {
    this.#db.prepare('DELETE FROM searches WHERE id = ?').run(search);
    this.#notifyChange();
  }

  #rowToFile(row: any): FileDTO {
    const tagRows = this.#db
      .prepare('SELECT tag_id FROM file_tags WHERE file_id = ?')
      .all(row.id) as { tag_id: string }[];
    return {
      id: row.id,
      ino: row.ino,
      locationId: row.locationId,
      relativePath: row.relativePath,
      absolutePath: row.absolutePath,
      name: row.name,
      extension: row.extension,
      size: row.size,
      width: row.width,
      height: row.height,
      dateAdded: new Date(row.dateAdded),
      dateModified: new Date(row.dateModified),
      dateCreated: new Date(row.dateCreated),
      dateLastIndexed: new Date(row.dateLastIndexed),
      annotations: row.annotations,
      lat: gpsFromRow(row.lat, row.latChecked),
      lng: gpsFromRow(row.lng, row.lngChecked),
      tags: tagRows.map((r) => r.tag_id),
    };
  }

  #writeFileTags(fileId: string, tags: string[]): void {
    this.#db.prepare('DELETE FROM file_tags WHERE file_id = ?').run(fileId);
    const insert = this.#db.prepare('INSERT INTO file_tags (file_id, tag_id) VALUES (?, ?)');
    tags.forEach((tagId) => insert.run(fileId, tagId));
  }

  #sortAndOrder(files: FileDTO[], order: OrderBy<FileDTO>, fileOrder: OrderDirection): FileDTO[] {
    if (order === 'random') {
      return shuffleArray(files);
    }
    const sorted = [...files].sort((a, b) => {
      const av = (a as any)[order];
      const bv = (b as any)[order];
      if (av < bv) return -1;
      if (av > bv) return 1;
      return 0;
    });
    return fileOrder === OrderDirection.Desc ? sorted.reverse() : sorted;
  }

  async fetchFiles(order: OrderBy<FileDTO>, fileOrder: OrderDirection): Promise<FileDTO[]> {
    const rows = this.#db.prepare('SELECT * FROM files').all() as any[];
    return this.#sortAndOrder(rows.map((r) => this.#rowToFile(r)), order, fileOrder);
  }

  async fetchFilesByID(ids: ID[]): Promise<FileDTO[]> {
    if (ids.length === 0) {
      return [];
    }
    const placeholders = ids.map(() => '?').join(',');
    const rows = this.#db
      .prepare(`SELECT * FROM files WHERE id IN (${placeholders})`)
      .all(...ids) as any[];
    return rows.map((r) => this.#rowToFile(r));
  }

  async fetchFilesByKey(key: keyof FileDTO, value: unknown): Promise<FileDTO[]> {
    const rows = this.#db
      .prepare(`SELECT * FROM files WHERE "${String(key)}" = ?`)
      .all(value as any) as any[];
    return rows.map((r) => this.#rowToFile(r));
  }

  async searchFiles(
    criteria: ConditionDTO<FileDTO> | [ConditionDTO<FileDTO>, ...ConditionDTO<FileDTO>[]],
    order: OrderBy<FileDTO>,
    fileOrder: OrderDirection,
    matchAny?: boolean,
  ): Promise<FileDTO[]> {
    const criterias = Array.isArray(criteria) ? criteria : ([criteria] as [ConditionDTO<FileDTO>]);
    const lambdas = criterias.map((crit) => filterLambda(crit));
    const conjunction = matchAny ? 'some' : 'every';
    const allFiles = await this.fetchFiles('id', OrderDirection.Asc);
    const matched = allFiles.filter((file) => lambdas[conjunction]((lambda) => lambda(file)));
    return this.#sortAndOrder(matched, order, fileOrder);
  }

  async saveFiles(files: FileDTO[]): Promise<void> {
    const run = this.#db.transaction((items: FileDTO[]) => {
      const upsert = this.#db.prepare(`
        INSERT INTO files (id, ino, locationId, relativePath, absolutePath, name, extension, size, width, height,
                            dateAdded, dateModified, dateCreated, dateLastIndexed, annotations, lat, lng,
                            latChecked, lngChecked)
        VALUES (@id, @ino, @locationId, @relativePath, @absolutePath, @name, @extension, @size, @width, @height,
                @dateAdded, @dateModified, @dateCreated, @dateLastIndexed, @annotations, @lat, @lng,
                @latChecked, @lngChecked)
        ON CONFLICT(id) DO UPDATE SET
          ino=excluded.ino, locationId=excluded.locationId, relativePath=excluded.relativePath,
          absolutePath=excluded.absolutePath, name=excluded.name, extension=excluded.extension,
          size=excluded.size, width=excluded.width, height=excluded.height, dateAdded=excluded.dateAdded,
          dateModified=excluded.dateModified, dateCreated=excluded.dateCreated,
          dateLastIndexed=excluded.dateLastIndexed, annotations=excluded.annotations,
          lat=excluded.lat, lng=excluded.lng, latChecked=excluded.latChecked, lngChecked=excluded.lngChecked
      `);
      for (const file of items) {
        upsert.run({
          ...file,
          dateAdded: file.dateAdded.toISOString(),
          dateModified: file.dateModified.toISOString(),
          dateCreated: file.dateCreated.toISOString(),
          dateLastIndexed: file.dateLastIndexed.toISOString(),
          ...gpsParams(file),
        });
        this.#writeFileTags(file.id, file.tags);
      }
    });
    run(files);
    this.#notifyChange();
  }

  async createFilesFromPath(path: string, files: FileDTO[]): Promise<void> {
    const run = this.#db.transaction((prefix: string, items: FileDTO[]) => {
      const escapedPrefix = prefix.replace(/[\\%_]/g, '\\$&');
      const existing = new Set(
        (
          this.#db
            .prepare(`SELECT absolutePath FROM files WHERE absolutePath LIKE ? || '%' ESCAPE '\\'`)
            .all(escapedPrefix) as { absolutePath: string }[]
        ).map((r) => r.absolutePath),
      );
      const toInsert = items.filter((f) => !existing.has(f.absolutePath));
      const insert = this.#db.prepare(`
        INSERT INTO files (id, ino, locationId, relativePath, absolutePath, name, extension, size, width, height,
                            dateAdded, dateModified, dateCreated, dateLastIndexed, annotations, lat, lng,
                            latChecked, lngChecked)
        VALUES (@id, @ino, @locationId, @relativePath, @absolutePath, @name, @extension, @size, @width, @height,
                @dateAdded, @dateModified, @dateCreated, @dateLastIndexed, @annotations, @lat, @lng,
                @latChecked, @lngChecked)
      `);
      for (const file of toInsert) {
        insert.run({
          ...file,
          dateAdded: file.dateAdded.toISOString(),
          dateModified: file.dateModified.toISOString(),
          dateCreated: file.dateCreated.toISOString(),
          dateLastIndexed: file.dateLastIndexed.toISOString(),
          ...gpsParams(file),
        });
        this.#writeFileTags(file.id, file.tags);
      }
    });
    run(path, files);
    this.#notifyChange();
  }

  async removeFiles(files: ID[]): Promise<void> {
    if (files.length === 0) {
      return;
    }
    const placeholders = files.map(() => '?').join(',');
    this.#db.prepare(`DELETE FROM files WHERE id IN (${placeholders})`).run(...files);
    this.#notifyChange();
  }

  async fetchDismissedDuplicateGroups(): Promise<DismissedDuplicateGroupDTO[]> {
    const rows = this.#db
      .prepare('SELECT * FROM dismissed_duplicate_groups ORDER BY dismissedAt DESC')
      .all() as any[];
    return rows.map((r) => ({
      id: r.id,
      groupHash: r.groupHash,
      algorithm: r.algorithm,
      fileIds: r.fileIds,
      dismissedAt: new Date(r.dismissedAt),
      userNote: r.userNote ?? undefined,
    }));
  }

  async createDismissedDuplicateGroup(group: DismissedDuplicateGroupDTO): Promise<void> {
    const run = this.#db.transaction((g: DismissedDuplicateGroupDTO) => {
      this.#db.prepare('DELETE FROM dismissed_duplicate_groups WHERE groupHash = ?').run(g.groupHash);
      this.#db
        .prepare(
          'INSERT INTO dismissed_duplicate_groups (id, groupHash, algorithm, fileIds, dismissedAt, userNote) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(g.id, g.groupHash, g.algorithm, g.fileIds, g.dismissedAt.toISOString(), g.userNote ?? null);
    });
    run(group);
    this.#notifyChange();
  }

  async removeDismissedDuplicateGroup(groupHash: string): Promise<void> {
    this.#db.prepare('DELETE FROM dismissed_duplicate_groups WHERE groupHash = ?').run(groupHash);
    this.#notifyChange();
  }

  async fetchVisualHashes(absolutePaths: string[]): Promise<VisualHashDTO[]> {
    if (absolutePaths.length === 0) {
      return [];
    }
    const placeholders = absolutePaths.map(() => '?').join(',');
    const rows = this.#db
      .prepare(`SELECT * FROM visual_hashes WHERE absolutePath IN (${placeholders})`)
      .all(...absolutePaths) as any[];
    return rows.map((r) => ({
      id: r.id,
      absolutePath: r.absolutePath,
      fileSize: r.fileSize,
      dateModified: new Date(r.dateModified),
      hashType: r.hashType,
      hash: r.hash,
      dateComputed: new Date(r.dateComputed),
      thumbnailPath: r.thumbnailPath ?? undefined,
    }));
  }

  async saveVisualHashes(hashes: VisualHashDTO[]): Promise<void> {
    const run = this.#db.transaction((items: VisualHashDTO[]) => {
      const upsert = this.#db.prepare(`
        INSERT INTO visual_hashes (id, absolutePath, fileSize, dateModified, hashType, hash, dateComputed, thumbnailPath)
        VALUES (@id, @absolutePath, @fileSize, @dateModified, @hashType, @hash, @dateComputed, @thumbnailPath)
        ON CONFLICT(absolutePath) DO UPDATE SET
          fileSize=excluded.fileSize, dateModified=excluded.dateModified, hashType=excluded.hashType,
          hash=excluded.hash, dateComputed=excluded.dateComputed, thumbnailPath=excluded.thumbnailPath
      `);
      for (const h of items) {
        upsert.run({
          id: h.id ?? generateId(),
          absolutePath: h.absolutePath,
          fileSize: h.fileSize,
          dateModified: h.dateModified.toISOString(),
          hashType: h.hashType,
          hash: h.hash,
          dateComputed: h.dateComputed.toISOString(),
          thumbnailPath: h.thumbnailPath ?? null,
        });
      }
    });
    run(hashes);
    this.#notifyChange();
  }

  async removeVisualHashes(absolutePaths: string[]): Promise<void> {
    if (absolutePaths.length === 0) {
      return;
    }
    const placeholders = absolutePaths.map(() => '?').join(',');
    this.#db.prepare(`DELETE FROM visual_hashes WHERE absolutePath IN (${placeholders})`).run(...absolutePaths);
    this.#notifyChange();
  }

  async clearVisualHashCache(): Promise<void> {
    this.#db.prepare('DELETE FROM visual_hashes').run();
    this.#notifyChange();
  }

  async fetchFacesForFile(fileId: ID): Promise<FaceDTO[]> {
    const rows = this.#db.prepare('SELECT * FROM faces WHERE file_id = ?').all(fileId) as any[];
    return rows.map(rowToFaceDTO);
  }

  async fetchFacesForFiles(fileIds: ID[]): Promise<FaceDTO[]> {
    if (fileIds.length === 0) {
      return [];
    }
    const placeholders = fileIds.map(() => '?').join(',');
    const rows = this.#db
      .prepare(`SELECT * FROM faces WHERE file_id IN (${placeholders})`)
      .all(...fileIds) as any[];
    return rows.map(rowToFaceDTO);
  }

  async fetchFaceDetectionStatuses(fileIds: ID[]): Promise<FaceDetectionStatusDTO[]> {
    if (fileIds.length === 0) {
      return [];
    }
    const placeholders = fileIds.map(() => '?').join(',');
    const rows = this.#db
      .prepare(`SELECT * FROM face_detection_status WHERE file_id IN (${placeholders})`)
      .all(...fileIds) as any[];
    return rows.map((r) => ({
      fileId: r.file_id,
      status: r.status,
      dateDetected: new Date(r.dateDetected),
    }));
  }

  async saveFaceDetectionResult(status: FaceDetectionStatusDTO, faces: FaceDTO[]): Promise<void> {
    const run = this.#db.transaction((s: FaceDetectionStatusDTO, fs: FaceDTO[]) => {
      this.#db.prepare('DELETE FROM faces WHERE file_id = ?').run(s.fileId);
      const insert = this.#db.prepare(`
        INSERT INTO faces (id, file_id, boundingBox, descriptor, personId, dateDetected)
        VALUES (@id, @file_id, @boundingBox, @descriptor, @personId, @dateDetected)
      `);
      for (const f of fs) {
        insert.run({
          id: f.id ?? generateId(),
          file_id: f.fileId,
          boundingBox: JSON.stringify(f.boundingBox),
          descriptor: JSON.stringify(f.descriptor),
          personId: f.personId ?? null,
          dateDetected: f.dateDetected.toISOString(),
        });
      }
      this.#db
        .prepare(
          `INSERT INTO face_detection_status (file_id, status, dateDetected)
           VALUES (@file_id, @status, @dateDetected)
           ON CONFLICT(file_id) DO UPDATE SET status=excluded.status, dateDetected=excluded.dateDetected`,
        )
        .run({
          file_id: s.fileId,
          status: s.status,
          dateDetected: s.dateDetected.toISOString(),
        });
    });
    run(status, faces);
    this.#notifyChange();
  }

  async countFiles(): Promise<[fileCount: number, untaggedFileCount: number]> {
    const fileCount = (this.#db.prepare('SELECT COUNT(*) as c FROM files').get() as { c: number }).c;
    const untaggedFileCount = (
      this.#db
        .prepare(
          'SELECT COUNT(*) as c FROM files WHERE id NOT IN (SELECT DISTINCT file_id FROM file_tags)',
        )
        .get() as { c: number }
    ).c;
    return [fileCount, untaggedFileCount];
  }

  async clearFilesOnly(): Promise<void> {
    const run = this.#db.transaction(() => {
      this.#db.prepare('DELETE FROM files').run();
      this.#db.prepare('DELETE FROM visual_hashes').run();
      this.#db.prepare('DELETE FROM dismissed_duplicate_groups').run();
    });
    run();
    this.#notifyChange();
  }

  async clear(): Promise<void> {
    const run = this.#db.transaction(() => {
      this.#db.prepare('DELETE FROM file_tags').run();
      this.#db.prepare('DELETE FROM files').run();
      this.#db.prepare('DELETE FROM tag_subtags').run();
      this.#db.prepare('DELETE FROM tags').run();
      this.#db.prepare('DELETE FROM locations').run();
      this.#db.prepare('DELETE FROM searches').run();
      this.#db.prepare('DELETE FROM dismissed_duplicate_groups').run();
      this.#db.prepare('DELETE FROM visual_hashes').run();
    });
    run();
    // Best effort: the app relaunches right after clearing, so don't fail the clear itself if
    // another window's connection happens to block the checkpoint.
    try {
      this.checkpoint();
    } catch (e) {
      console.warn('Could not checkpoint context file before closing', e);
    }
    this.#db.close();
  }

  /**
   * Folds the write-ahead log back into the context file and closes the connection, so no `-wal`
   * sidecar is left travelling separately from the (portable) `.onefolder` file. Throws, leaving
   * the connection open, if another connection blocked the checkpoint from completing.
   */
  close(): void {
    this.checkpoint();
    this.#db.close();
  }

  /** TRUNCATE checkpoint: everything in the WAL is written to the main file and the WAL emptied. */
  checkpoint(): void {
    const [result] = this.#db.pragma('wal_checkpoint(TRUNCATE)') as { busy: number }[];
    if (result && result.busy !== 0) {
      throw new Error('Could not checkpoint the context file: it is busy in another connection.');
    }
  }

  /** Online backup of the live context (including not-yet-checkpointed WAL data) to `targetPath`. */
  async backupTo(targetPath: string): Promise<void> {
    await this.#db.backup(targetPath);
    // The copy inherits WAL mode from the live file, so merely opening it (e.g. to peek at it)
    // would create -wal/-shm sidecars beside it. Store backups as plain self-contained files;
    // initSqliteSchema switches a restored file back to WAL when it's next opened as a context.
    const copy = new Database(targetPath);
    try {
      copy.pragma('journal_mode = DELETE');
    } finally {
      copy.close();
    }
  }

  get contextPath(): string {
    return this.#db.name;
  }
}
