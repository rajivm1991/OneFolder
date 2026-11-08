import { migrateViewMethod, VIEW_METHOD_VERSION } from '../src/frontend/stores/view-method-migration';

// Numbers before the Calendar view was removed: List 0, Grid 1, MasonryVertical 2, MasonryHorizontal 3,
// Calendar 4, Map 5, Faces 6, Duplicates 7. After: Map 4, Faces 5, Duplicates 6.
describe('migrateViewMethod', () => {
  it('keeps the entries before Calendar', () => {
    expect([0, 1, 2, 3].map((n) => migrateViewMethod(n, undefined))).toEqual([0, 1, 2, 3]);
  });

  it('opens Grid for a stored Calendar', () => {
    expect(migrateViewMethod(4, undefined)).toBe(1);
  });

  it('moves Map, Faces and Duplicates down by one', () => {
    expect(migrateViewMethod(5, undefined)).toBe(4);
    expect(migrateViewMethod(6, undefined)).toBe(5);
    expect(migrateViewMethod(7, undefined)).toBe(6);
  });

  it('leaves numbers that were already stored in the new numbering alone', () => {
    for (const n of [0, 1, 2, 3, 4, 5, 6]) {
      expect(migrateViewMethod(n, VIEW_METHOD_VERSION)).toBe(n);
    }
  });
});
