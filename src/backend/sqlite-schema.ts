import Database from 'better-sqlite3';

/** Idempotent: safe to call against a file that already has the schema. */
export function initSqliteSchema(db: Database.Database): void {
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS tags (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      dateAdded TEXT NOT NULL,
      color TEXT NOT NULL,
      isHidden INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tag_subtags (
      tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      sub_tag_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      PRIMARY KEY (tag_id, sub_tag_id)
    );

    CREATE TABLE IF NOT EXISTS locations (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL,
      dateAdded TEXT NOT NULL,
      "index" INTEGER NOT NULL,
      subLocations TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS searches (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      criteria TEXT NOT NULL,
      matchAny INTEGER,
      "index" INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY,
      ino TEXT NOT NULL,
      locationId TEXT NOT NULL,
      relativePath TEXT NOT NULL,
      absolutePath TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      extension TEXT NOT NULL,
      size INTEGER NOT NULL,
      width INTEGER NOT NULL,
      height INTEGER NOT NULL,
      dateAdded TEXT NOT NULL,
      dateModified TEXT NOT NULL,
      dateCreated TEXT NOT NULL,
      dateLastIndexed TEXT NOT NULL,
      annotations TEXT NOT NULL,
      lat REAL,
      lng REAL
    );
    CREATE INDEX IF NOT EXISTS idx_files_locationId ON files(locationId);

    CREATE TABLE IF NOT EXISTS file_tags (
      file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
      tag_id TEXT NOT NULL,
      PRIMARY KEY (file_id, tag_id)
    );
    CREATE INDEX IF NOT EXISTS idx_file_tags_tag_id ON file_tags(tag_id);

    CREATE TABLE IF NOT EXISTS dismissed_duplicate_groups (
      id TEXT PRIMARY KEY,
      groupHash TEXT NOT NULL UNIQUE,
      algorithm TEXT NOT NULL,
      fileIds TEXT NOT NULL,
      dismissedAt TEXT NOT NULL,
      userNote TEXT
    );

    CREATE TABLE IF NOT EXISTS visual_hashes (
      id TEXT PRIMARY KEY,
      absolutePath TEXT NOT NULL UNIQUE,
      fileSize INTEGER NOT NULL,
      dateModified TEXT NOT NULL,
      hashType TEXT NOT NULL,
      hash TEXT NOT NULL,
      dateComputed TEXT NOT NULL,
      thumbnailPath TEXT
    );
  `);
}
