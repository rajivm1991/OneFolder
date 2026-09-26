import fs from 'fs';
import path from 'path';

export const CONTEXT_SETTINGS_FILENAME = 'context-settings.json';
export const MAX_RECENT_CONTEXTS = 10;

export type ContextSettings = {
  lastOpenedContextPath: string | null;
  recentContexts: string[];
};

const DEFAULT_SETTINGS: ContextSettings = {
  lastOpenedContextPath: null,
  recentContexts: [],
};

function settingsPath(userDataPath: string): string {
  return path.join(userDataPath, CONTEXT_SETTINGS_FILENAME);
}

export function readContextSettings(userDataPath: string): ContextSettings {
  const filePath = settingsPath(userDataPath);
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    return {
      lastOpenedContextPath: parsed.lastOpenedContextPath ?? null,
      recentContexts: Array.isArray(parsed.recentContexts) ? parsed.recentContexts : [],
    };
  } catch (e) {
    return { ...DEFAULT_SETTINGS };
  }
}

export function writeContextSettings(userDataPath: string, settings: ContextSettings): void {
  const filePath = settingsPath(userDataPath);
  fs.mkdirSync(userDataPath, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(settings, null, 2), 'utf-8');
}

/**
 * File > New Context…: makes the chosen context file exist before the app relaunches into it.
 * Without it, startup can't tell a not-yet-created context from one on an unplugged drive, and
 * falls back to the default context. The file is left empty on purpose: SqliteBackend.init
 * turns an existing empty file into a fresh context (schema + root tag) when it's opened, which
 * keeps better-sqlite3 (a native module) out of the main process. Never truncates an existing
 * file, so choosing an existing context in the save dialog just opens it.
 */
export function createContextPlaceholder(contextPath: string): void {
  fs.mkdirSync(path.dirname(contextPath), { recursive: true });
  try {
    fs.closeSync(fs.openSync(contextPath, 'wx'));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw e;
    }
  }
}

export function recordOpenedContext(userDataPath: string, contextPath: string): ContextSettings {
  const current = readContextSettings(userDataPath);
  const deduped = current.recentContexts.filter((p) => p !== contextPath);
  const recentContexts = [contextPath, ...deduped].slice(0, MAX_RECENT_CONTEXTS);
  const next: ContextSettings = { lastOpenedContextPath: contextPath, recentContexts };
  writeContextSettings(userDataPath, next);
  return next;
}
