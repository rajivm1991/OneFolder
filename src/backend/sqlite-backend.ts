import Database from 'better-sqlite3';
import fs from 'fs';

import { ID } from '../api/id';
import { LocationDTO } from '../api/location';
import { FileSearchDTO } from '../api/file-search';
import { ROOT_TAG_ID, TagDTO } from '../api/tag';
import { initSqliteSchema } from './sqlite-schema';

type TagRow = {
  id: string;
  name: string;
  dateAdded: string;
  color: string;
  isHidden: number;
};

export class SqliteBackend {
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
      db.prepare(
        'INSERT INTO tags (id, name, dateAdded, color, isHidden) VALUES (?, ?, ?, ?, ?)',
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
}
