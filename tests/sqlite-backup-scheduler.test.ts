import Database from 'better-sqlite3';
import fse from 'fs-extra';
import os from 'os';
import path from 'path';
import { TagDTO } from '../src/api/tag';
import { SqliteBackend } from '../src/backend/sqlite-backend';
import { SqliteBackupScheduler } from '../src/backend/sqlite-backup-scheduler';

function tag(id: string): TagDTO {
  return { id, name: id, dateAdded: new Date(), color: '', subTags: [], isHidden: false };
}

async function tagIds(contextPath: string): Promise<string[]> {
  // A fresh connection, as the app would have after relaunching.
  const db = new Database(contextPath, { readonly: true });
  try {
    return (db.prepare('SELECT id FROM tags ORDER BY id').all() as { id: string }[]).map(
      (r) => r.id,
    );
  } finally {
    db.close();
  }
}

async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error('Timed out waiting for condition');
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe('SqliteBackupScheduler', () => {
  let tmpDir: string;
  let contextPath: string;
  let backupRoot: string;
  let backend: SqliteBackend;

  beforeEach(async () => {
    tmpDir = await fse.mkdtemp(path.join(os.tmpdir(), 'onefolder-backup-'));
    contextPath = path.join(tmpDir, 'work.onefolder');
    backupRoot = path.join(tmpDir, 'backups');
    backend = await SqliteBackend.init(contextPath, () => {});
  });

  afterEach(async () => {
    try {
      backend.close();
    } catch (e) {
      // already closed by the test (e.g. by a restore)
    }
    await fse.remove(tmpDir);
  });

  it('backs up data that is still only in the WAL, not yet checkpointed into the context file', async () => {
    for (let i = 0; i < 50; i++) {
      await backend.createTag(tag(`tag${String(i).padStart(2, '0')}`));
    }
    // Precondition for this regression test: the recent writes really are WAL-buffered.
    expect((await fse.stat(`${contextPath}-wal`)).size).toBeGreaterThan(0);

    const scheduler = new SqliteBackupScheduler(backend, backupRoot);
    const backupPath = path.join(tmpDir, 'manual', 'manual.onefolder');
    await scheduler.backupToFile(backupPath);

    const ids = await tagIds(backupPath);
    expect(ids).toHaveLength(51);
    expect(ids).toContain('tag49');
    // The backup is self-contained, even after being opened: no sidecar needs to travel with it.
    expect(await fse.pathExists(`${backupPath}-wal`)).toBe(false);
    expect(await fse.pathExists(`${backupPath}-shm`)).toBe(false);
  });

  it('restoring replaces the live context, and is not undone by the live connection afterwards', async () => {
    await backend.createTag(tag('A'));
    const scheduler = new SqliteBackupScheduler(backend, backupRoot);
    const backupPath = path.join(tmpDir, 'a-only.onefolder');
    await scheduler.backupToFile(backupPath);

    await backend.createTag(tag('B'));
    expect(await tagIds(contextPath)).toEqual(['A', 'B', 'root']);

    await scheduler.restoreFromFile(backupPath);

    // Simulate the relaunch that follows a restore: a brand new connection to the same file.
    expect(await tagIds(contextPath)).toEqual(['A', 'root']);
    const reopened = await SqliteBackend.init(contextPath, () => {});
    expect((await reopened.fetchTags()).map((t) => t.id).sort()).toEqual(['A', 'root']);
    reopened.close();
  });

  it('refuses to restore, leaving the live context untouched, if the WAL cannot be checkpointed', async () => {
    await backend.createTag(tag('A'));
    const scheduler = new SqliteBackupScheduler(backend, backupRoot);
    const backupPath = path.join(tmpDir, 'a-only.onefolder');
    await scheduler.backupToFile(backupPath);

    // Another connection (e.g. the preview window) holding a read snapshot blocks a full checkpoint.
    const other = new Database(contextPath);
    other.prepare('BEGIN').run();
    other.prepare('SELECT COUNT(*) FROM tags').get();
    await backend.createTag(tag('B'));

    try {
      await expect(scheduler.restoreFromFile(backupPath)).rejects.toThrow(/busy/);
    } finally {
      other.prepare('COMMIT').run();
      other.close();
    }
    expect((await backend.fetchTags()).map((t) => t.id).sort()).toEqual(['A', 'B', 'root']);
  }, 20_000); // the checkpoint waits out better-sqlite3's 5s busy timeout before giving up

  it('peeks a backup file and reports tag/file counts', async () => {
    const peekFilePath = path.join(tmpDir, 'peek.onefolder');
    const db = new Database(peekFilePath);
    db.exec('CREATE TABLE tags (id TEXT)');
    db.exec("INSERT INTO tags VALUES ('a'), ('b')");
    db.exec('CREATE TABLE files (id TEXT)');
    db.exec("INSERT INTO files VALUES ('x'), ('y'), ('z')");
    db.close();

    const scheduler = new SqliteBackupScheduler(backend, backupRoot);
    const result = await scheduler.peekFile(peekFilePath);
    expect(result).toEqual([2, 3]);
  });

  it('gives each context its own backup subdirectory, so rotation slots never collide', async () => {
    const otherContextPath = path.join(tmpDir, 'school.onefolder');
    const otherBackend = await SqliteBackend.init(otherContextPath, () => {});
    await backend.createTag(tag('work-tag'));
    await otherBackend.createTag(tag('school-tag'));

    const workScheduler = new SqliteBackupScheduler(backend, backupRoot);
    const schoolScheduler = new SqliteBackupScheduler(otherBackend, backupRoot);

    expect(workScheduler.backupDirectory).not.toBe(schoolScheduler.backupDirectory);
    expect(path.dirname(workScheduler.backupDirectory)).toBe(backupRoot);
    expect(path.dirname(schoolScheduler.backupDirectory)).toBe(backupRoot);
    // Deterministic: reopening the same context finds its own prior backups.
    expect(new SqliteBackupScheduler(backend, backupRoot).backupDirectory).toBe(
      workScheduler.backupDirectory,
    );

    // Run a real periodic backup for each (it is debounced, so fast-forward the debounce timer).
    jest.useFakeTimers();
    try {
      workScheduler.schedule();
      schoolScheduler.schedule();
      jest.advanceTimersByTime(10_000);
    } finally {
      jest.useRealTimers();
    }
    const workDaily = path.join(workScheduler.backupDirectory, 'daily.onefolder');
    const schoolDaily = path.join(schoolScheduler.backupDirectory, 'daily.onefolder');
    await waitFor(() => fse.pathExistsSync(workDaily) && fse.pathExistsSync(schoolDaily));

    expect(workDaily).not.toBe(schoolDaily);
    expect(await tagIds(workDaily)).toEqual(['root', 'work-tag']);
    expect(await tagIds(schoolDaily)).toEqual(['root', 'school-tag']);
    otherBackend.close();
  });
});
