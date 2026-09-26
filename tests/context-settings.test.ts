import fse from 'fs-extra';
import os from 'os';
import path from 'path';
import {
  readContextSettings,
  writeContextSettings,
  recordOpenedContext,
} from '../src/backend/context-settings';

describe('context-settings', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fse.mkdtempSync(path.join(os.tmpdir(), 'onefolder-ctx-settings-'));
  });

  afterEach(() => {
    fse.removeSync(tmpDir);
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
