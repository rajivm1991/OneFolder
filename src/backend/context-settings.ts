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

export function recordOpenedContext(userDataPath: string, contextPath: string): ContextSettings {
  const current = readContextSettings(userDataPath);
  const deduped = current.recentContexts.filter((p) => p !== contextPath);
  const recentContexts = [contextPath, ...deduped].slice(0, MAX_RECENT_CONTEXTS);
  const next: ContextSettings = { lastOpenedContextPath: contextPath, recentContexts };
  writeContextSettings(userDataPath, next);
  return next;
}
