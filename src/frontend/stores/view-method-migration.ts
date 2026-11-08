/**
 * The view method is stored as the number of its ViewMethod entry. Removing the Calendar entry (number 4)
 * shifted the entries after it down by one, so a number stored before that has to be translated.
 */

/** Marks stored preferences written after the Calendar view was removed */
export const VIEW_METHOD_VERSION = 2;

const LEGACY_CALENDAR = 4;
/** The entry that a stored Calendar view opens instead: Grid */
const GRID = 1;
/** The last entry of ViewMethod (Duplicates) in the current numbering */
const LAST_METHOD = 6;

/**
 * Returns the number of the current ViewMethod entry for a stored one.
 * @param stored the stored number
 * @param version the stored VIEW_METHOD_VERSION, undefined for preferences from before it existed
 */
export function migrateViewMethod(stored: number, version: number | undefined): number {
  let method = stored;
  if (version === undefined || version < VIEW_METHOD_VERSION) {
    if (stored === LEGACY_CALENDAR) {
      method = GRID;
    } else if (stored > LEGACY_CALENDAR) {
      method = stored - 1;
    }
  }
  // Missing, invalid or out of range (NaN from a missing value, a number from a newer app version): show Grid
  return Number.isInteger(method) && method >= 0 && method <= LAST_METHOD ? method : GRID;
}
