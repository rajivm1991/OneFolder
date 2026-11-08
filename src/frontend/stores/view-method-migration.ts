/**
 * The view method is stored as the number of its ViewMethod entry. Removing the Calendar entry (number 4)
 * shifted the entries after it down by one, so a number stored before that has to be translated.
 */

/** Marks stored preferences written after the Calendar view was removed */
export const VIEW_METHOD_VERSION = 2;

const LEGACY_CALENDAR = 4;
/** The entry that a stored Calendar view opens instead: Grid */
const GRID = 1;

/**
 * Returns the number of the current ViewMethod entry for a stored one.
 * @param stored the stored number
 * @param version the stored VIEW_METHOD_VERSION, undefined for preferences from before it existed
 */
export function migrateViewMethod(stored: number, version: number | undefined): number {
  if (version !== undefined && version >= VIEW_METHOD_VERSION) {
    return stored;
  }
  if (stored === LEGACY_CALENDAR) {
    return GRID;
  }
  return stored > LEGACY_CALENDAR ? stored - 1 : stored;
}
