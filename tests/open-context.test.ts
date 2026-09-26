import fse from 'fs-extra';
import os from 'os';
import path from 'path';
import { readContextSettings, recordOpenedContext } from '../src/backend/context-settings';
import { openAndRecordContext } from '../src/backend/open-context';

describe('openAndRecordContext', () => {
  let tmpDir: string;
  let userDataPath: string;

  beforeEach(async () => {
    tmpDir = await fse.mkdtemp(path.join(os.tmpdir(), 'onefolder-open-'));
    userDataPath = path.join(tmpDir, 'userData');
  });

  afterEach(async () => {
    await fse.remove(tmpDir);
  });

  it('records the context as last opened once it has opened successfully', async () => {
    const contextPath = path.join(tmpDir, 'work.onefolder');
    const backend = await openAndRecordContext(userDataPath, contextPath, () => {});
    expect(readContextSettings(userDataPath).lastOpenedContextPath).toBe(contextPath);
    backend.close();
  });

  it('does not record a context that fails to open, keeping the previous working one', async () => {
    const goodPath = path.join(tmpDir, 'good.onefolder');
    recordOpenedContext(userDataPath, goodPath);

    const brokenPath = path.join(tmpDir, 'broken.onefolder');
    await fse.writeFile(brokenPath, 'this is not a sqlite database, just some bytes'.repeat(100));

    await expect(openAndRecordContext(userDataPath, brokenPath, () => {})).rejects.toThrow();
    expect(readContextSettings(userDataPath).lastOpenedContextPath).toBe(goodPath);
    expect(readContextSettings(userDataPath).recentContexts).not.toContain(brokenPath);
  });
});
