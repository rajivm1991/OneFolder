import fse from 'fs-extra';
import os from 'os';
import path from 'path';
import { ROOT_TAG_ID } from '../src/api/tag';
import {
  readContextSettings,
  writeContextSettings,
  recordOpenedContext,
  createContextPlaceholder,
} from '../src/backend/context-settings';
import { SqliteBackend } from '../src/backend/sqlite-backend';

describe('context-settings', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fse.mkdtemp(path.join(os.tmpdir(), 'onefolder-ctx-settings-'));
  });

  afterEach(async () => {
    await fse.remove(tmpDir);
  });

  it('returns empty defaults when no settings file exists yet', () => {
    const settings = readContextSettings(tmpDir);
    expect(settings).toEqual({ lastOpenedContextPath: null, recentContexts: [] });
  });

  it('round-trips written settings', () => {
    writeContextSettings(tmpDir, {
      lastOpenedContextPath: '/drives/work/work.onefolder',
      recentContexts: ['/drives/work/work.onefolder'],
    });
    expect(readContextSettings(tmpDir)).toEqual({
      lastOpenedContextPath: '/drives/work/work.onefolder',
      recentContexts: ['/drives/work/work.onefolder'],
    });
  });

  it('recordOpenedContext puts the path first and de-duplicates', () => {
    recordOpenedContext(tmpDir, '/drives/school/school.onefolder');
    const settings = recordOpenedContext(tmpDir, '/drives/work/work.onefolder');
    recordOpenedContext(tmpDir, '/drives/school/school.onefolder');
    const final = readContextSettings(tmpDir);
    expect(final.lastOpenedContextPath).toBe('/drives/school/school.onefolder');
    expect(final.recentContexts).toEqual([
      '/drives/school/school.onefolder',
      '/drives/work/work.onefolder',
    ]);
    expect(settings.lastOpenedContextPath).toBe('/drives/work/work.onefolder');
  });

  it('caps recentContexts at 10 entries', () => {
    for (let i = 0; i < 15; i++) {
      recordOpenedContext(tmpDir, `/drives/ctx-${i}.onefolder`);
    }
    expect(readContextSettings(tmpDir).recentContexts).toHaveLength(10);
  });
});

describe('createContextPlaceholder (File > New Context…)', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fse.mkdtemp(path.join(os.tmpdir(), 'onefolder-new-context-'));
  });

  afterEach(async () => {
    await fse.remove(tmpDir);
  });

  it('creates a file that opens as a fresh context with a valid schema and root tag', async () => {
    const contextPath = path.join(tmpDir, 'nested', 'new.onefolder');
    createContextPlaceholder(contextPath);
    // The file must exist before relaunch, or startup mistakes it for an unplugged drive.
    expect(await fse.pathExists(contextPath)).toBe(true);

    const backend = await SqliteBackend.init(contextPath, () => {});
    expect((await backend.fetchTags()).map((t) => t.id)).toEqual([ROOT_TAG_ID]);
    expect(await backend.fetchLocations()).toEqual([]);
    expect(await backend.countFiles()).toEqual([0, 0]);
    backend.close();
  });

  it('never overwrites an existing file', async () => {
    const contextPath = path.join(tmpDir, 'existing.onefolder');
    const backend = await SqliteBackend.init(contextPath, () => {});
    await backend.createTag({
      id: 'keep-me',
      name: 'keep me',
      dateAdded: new Date(),
      color: '',
      subTags: [],
      isHidden: false,
    });
    backend.close();

    createContextPlaceholder(contextPath);

    const reopened = await SqliteBackend.init(contextPath, () => {});
    expect((await reopened.fetchTags()).map((t) => t.id).sort()).toEqual(['keep-me', ROOT_TAG_ID]);
    reopened.close();
  });
});
