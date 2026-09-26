import Database from 'better-sqlite3';
import fse from 'fs-extra';
import os from 'os';
import path from 'path';
import { SqliteBackupScheduler } from '../src/backend/sqlite-backup-scheduler';

describe('SqliteBackupScheduler', () => {
  let tmpDir: string;
  let contextPath: string;
  let backupDir: string;

  beforeEach(async () => {
    tmpDir = await fse.mkdtemp(path.join(os.tmpdir(), 'onefolder-backup-'));
    contextPath = path.join(tmpDir, 'work.onefolder');
    await fse.writeFile(contextPath, 'fake-sqlite-bytes');
    backupDir = path.join(tmpDir, 'backups');
  });

  afterEach(async () => {
    await fse.remove(tmpDir);
  });

  it('copies the context file into the backup directory', async () => {
    const scheduler = new SqliteBackupScheduler(contextPath, backupDir);
    await scheduler.backupToFile(path.join(backupDir, 'manual.onefolder'));
    const copied = await fse.readFile(path.join(backupDir, 'manual.onefolder'), 'utf-8');
    expect(copied).toBe('fake-sqlite-bytes');
  });

  it('restores the context file from a backup file', async () => {
    const backupFilePath = path.join(tmpDir, 'backup.onefolder');
    await fse.writeFile(backupFilePath, 'backup-sqlite-bytes');

    const scheduler = new SqliteBackupScheduler(contextPath, backupDir);
    await scheduler.restoreFromFile(backupFilePath);

    const restored = await fse.readFile(contextPath, 'utf-8');
    expect(restored).toBe('backup-sqlite-bytes');
  });

  it('peeks a backup file and reports tag/file counts', async () => {
    const peekFilePath = path.join(tmpDir, 'peek.onefolder');
    const db = new Database(peekFilePath);
    db.exec('CREATE TABLE tags (id TEXT)');
    db.exec("INSERT INTO tags VALUES ('a'), ('b')");
    db.exec('CREATE TABLE files (id TEXT)');
    db.exec("INSERT INTO files VALUES ('x'), ('y'), ('z')");
    db.close();

    const scheduler = new SqliteBackupScheduler(contextPath, backupDir);
    const result = await scheduler.peekFile(peekFilePath);
    expect(result).toEqual([2, 3]);
  });
});
