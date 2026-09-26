import Database from 'better-sqlite3';
import crypto from 'crypto';
import fse from 'fs-extra';
import path from 'path';

import { debounce } from '../../common/timeout';
import { DataBackup } from '../api/data-backup';
import { AUTO_BACKUP_TIMEOUT, NUM_AUTO_BACKUPS } from './config';
import { SqliteBackend } from './sqlite-backend';

function getToday(): Date {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

function getWeekStart(): Date {
  const date = getToday();
  date.setDate(date.getDate() - date.getDay());
  return date;
}

/**
 * Stable per-context subdirectory name, derived from the context file's absolute path, so that
 * contexts never share rotation slots (auto-backup-N/daily/weekly) and re-opening a context always
 * finds its own prior backups. A context whose drive mounts at a different path gets a new one.
 */
export function contextBackupSubdir(contextPath: string): string {
  return crypto.createHash('sha256').update(path.resolve(contextPath)).digest('hex').slice(0, 16);
}

/** Periodically backs up a live SQLite context into its own backup directory, with daily/weekly rotation. */
export class SqliteBackupScheduler implements DataBackup {
  #backend: SqliteBackend;
  #contextPath: string;
  #backupDirectory: string;
  #lastBackupIndex = 0;
  #lastBackupDate = new Date(0);

  /**
   * @param backend the live connection to the context being backed up
   * @param backupRootDirectory shared root for all contexts' backups; this context's backups go
   *   in a subdirectory of it (see {@link contextBackupSubdir})
   */
  constructor(backend: SqliteBackend, backupRootDirectory: string) {
    this.#backend = backend;
    this.#contextPath = backend.contextPath;
    this.#backupDirectory = path.join(backupRootDirectory, contextBackupSubdir(this.#contextPath));
  }

  get backupDirectory(): string {
    return this.#backupDirectory;
  }

  schedule(): void {
    if (new Date().getTime() > this.#lastBackupDate.getTime() + AUTO_BACKUP_TIMEOUT) {
      this.#createPeriodicBackup();
    }
  }

  /**
   * Uses SQLite's online backup through the live connection. A raw file copy would miss writes
   * still sitting in the `-wal` sidecar (under WAL mode that can be whole tables).
   */
  async backupToFile(targetPath: string): Promise<void> {
    await fse.ensureDir(path.dirname(targetPath));
    await this.#backend.backupTo(targetPath);
  }

  /**
   * Replaces the live context file with `targetPath`'s contents. The live connection is first
   * checkpointed (TRUNCATE) and closed, so its WAL can't later be replayed or checkpointed over the
   * restored file and undo the restore. Throws, without touching anything, if another connection
   * blocks the checkpoint. The backend is unusable afterwards: callers must relaunch the app (the
   * restore UI already does).
   */
  async restoreFromFile(targetPath: string): Promise<void> {
    console.info('SQLite: Importing context backup...', targetPath);
    this.#backend.close();
    await fse.copyFile(targetPath, this.#contextPath);
  }

  async peekFile(targetPath: string): Promise<[numTags: number, numFiles: number]> {
    console.info('SQLite: Peeking context backup...', targetPath);
    const db = new Database(targetPath, { readonly: true });
    try {
      const numTags = (db.prepare('SELECT COUNT(*) as c FROM tags').get() as { c: number }).c;
      const numFiles = (db.prepare('SELECT COUNT(*) as c FROM files').get() as { c: number }).c;
      return [numTags, numFiles];
    } finally {
      db.close();
    }
  }

  static async #copyIfOlderThan(srcPath: string, targetPath: string, cutoff: Date): Promise<void> {
    let shouldCopy = false;
    try {
      const stats = await fse.stat(targetPath);
      shouldCopy = stats.ctime < cutoff;
    } catch (e) {
      shouldCopy = true;
    }
    if (shouldCopy) {
      await fse.copyFile(srcPath, targetPath);
    }
  }

  #createPeriodicBackup = debounce(async (): Promise<void> => {
    const fileName = `auto-backup-${this.#lastBackupIndex}.onefolder`;
    const filePath = path.join(this.#backupDirectory, fileName);

    this.#lastBackupDate = new Date();
    this.#lastBackupIndex = (this.#lastBackupIndex + 1) % NUM_AUTO_BACKUPS;

    try {
      await this.backupToFile(filePath);
      await SqliteBackupScheduler.#copyIfOlderThan(
        filePath,
        path.join(this.#backupDirectory, 'daily.onefolder'),
        getToday(),
      );
      await SqliteBackupScheduler.#copyIfOlderThan(
        filePath,
        path.join(this.#backupDirectory, 'weekly.onefolder'),
        getWeekStart(),
      );
    } catch (e) {
      console.error('Could not create periodic context backup', filePath, e);
    }
  }, 10000);
}
