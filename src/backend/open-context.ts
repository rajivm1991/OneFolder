import { recordOpenedContext } from './context-settings';
import { SqliteBackend } from './sqlite-backend';

/**
 * Opens a context and only then records it as the last opened one. If opening throws (corrupt
 * file, drive unplugged mid-open, ...), the previously recorded working context stays the one the
 * next launch tries, instead of the app getting stuck retrying the broken path forever.
 *
 * Kept out of context-settings.ts on purpose: that module is also used by the main process, which
 * must not pull in better-sqlite3.
 */
export async function openAndRecordContext(
  userDataPath: string,
  contextPath: string,
  notifyChange: () => void,
): Promise<SqliteBackend> {
  const backend = await SqliteBackend.init(contextPath, notifyChange);
  recordOpenedContext(userDataPath, contextPath);
  return backend;
}
