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
});
