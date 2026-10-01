import {
  chunkIntoRows,
  computeColumns,
  calendarSortFixes,
  getGridArrowTarget,
  groupIndexAt,
  rowStartIndex,
} from '../src/frontend/containers/ContentView/calendar-utils';

describe('computeColumns', () => {
  it('fits as many whole cells as the width allows', () => {
    expect(computeColumns(1000, 200)).toBe(5);
    expect(computeColumns(999, 200)).toBe(4);
  });

  it('never returns less than 1', () => {
    expect(computeColumns(50, 200)).toBe(1);
    expect(computeColumns(0, 200)).toBe(1);
    expect(computeColumns(-10, 200)).toBe(1);
  });

  it('guards against a zero or invalid cell size', () => {
    expect(computeColumns(1000, 0)).toBe(1);
    expect(computeColumns(NaN, 200)).toBe(1);
  });
});

describe('chunkIntoRows', () => {
  it('returns no rows for no items', () => {
    expect(chunkIntoRows([], 3)).toEqual([]);
  });

  it('keeps a partial last row', () => {
    expect(chunkIntoRows([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('makes exactly one full row when items equal columns', () => {
    expect(chunkIntoRows([1, 2, 3], 3)).toEqual([[1, 2, 3]]);
  });

  it('makes a second row when items are columns + 1', () => {
    expect(chunkIntoRows([1, 2, 3, 4], 3)).toEqual([[1, 2, 3], [4]]);
  });

  it('treats columns < 1 as 1', () => {
    expect(chunkIntoRows([1, 2], 0)).toEqual([[1], [2]]);
  });
});

describe('rowStartIndex', () => {
  it('is 0 for the first group', () => {
    expect(rowStartIndex([5, 3], 0, 2)).toBe(0);
  });

  it('sums ceil(size / columns) of earlier groups', () => {
    // group 0: 5 files -> 3 rows, group 1: 3 files -> 2 rows
    expect(rowStartIndex([5, 3, 4], 1, 2)).toBe(3);
    expect(rowStartIndex([5, 3, 4], 2, 2)).toBe(5);
  });

  it('with columns = 1 equals the file index', () => {
    expect(rowStartIndex([5, 3, 4], 2, 1)).toBe(8);
  });
});

describe('getGridArrowTarget', () => {
  // 4 columns. Month A: 5 files (rows [0-3], [4]); month B: 6 files (rows [5-8], [9-10])
  const groups = [5, 6];

  it('moves to the same column in the next row of the same month', () => {
    expect(getGridArrowTarget(groups, 5, 'ArrowDown', 4)).toBe(9);
    expect(getGridArrowTarget(groups, 6, 'ArrowDown', 4)).toBe(10);
  });

  it('clamps to the end of a partial row', () => {
    expect(getGridArrowTarget(groups, 1, 'ArrowDown', 4)).toBe(4);
    expect(getGridArrowTarget(groups, 3, 'ArrowDown', 4)).toBe(4);
    expect(getGridArrowTarget(groups, 8, 'ArrowDown', 4)).toBe(10);
  });

  it('crosses into the first row of the next month, keeping the column', () => {
    expect(getGridArrowTarget(groups, 4, 'ArrowDown', 4)).toBe(5);
    expect(getGridArrowTarget([4, 6], 3, 'ArrowDown', 4)).toBe(7);
  });

  it('moves up to the same column in the previous row', () => {
    expect(getGridArrowTarget(groups, 10, 'ArrowUp', 4)).toBe(6);
    expect(getGridArrowTarget(groups, 9, 'ArrowUp', 4)).toBe(5);
  });

  it('crosses into the last row of the previous month, clamping the column', () => {
    expect(getGridArrowTarget(groups, 5, 'ArrowUp', 4)).toBe(4);
    expect(getGridArrowTarget(groups, 7, 'ArrowUp', 4)).toBe(4);
    expect(getGridArrowTarget([4, 6], 7, 'ArrowUp', 4)).toBe(3);
  });

  it('stays put (undefined) at the first and last row', () => {
    expect(getGridArrowTarget(groups, 0, 'ArrowUp', 4)).toBeUndefined();
    expect(getGridArrowTarget(groups, 2, 'ArrowUp', 4)).toBeUndefined();
    expect(getGridArrowTarget(groups, 10, 'ArrowDown', 4)).toBeUndefined();
    expect(getGridArrowTarget(groups, 9, 'ArrowDown', 4)).toBeUndefined();
  });

  it('moves one file at a time across months when columns is 1 (list mode)', () => {
    expect(getGridArrowTarget([2, 3], 0, 'ArrowDown', 1)).toBe(1);
    expect(getGridArrowTarget([2, 3], 1, 'ArrowDown', 1)).toBe(2);
    expect(getGridArrowTarget([2, 3], 2, 'ArrowUp', 1)).toBe(1);
  });

  it('ignores other keys and out-of-range positions', () => {
    expect(getGridArrowTarget(groups, 3, 'ArrowLeft', 4)).toBeUndefined();
    expect(getGridArrowTarget(groups, 99, 'ArrowDown', 4)).toBeUndefined();
    expect(getGridArrowTarget(groups, -1, 'ArrowDown', 4)).toBeUndefined();
    expect(getGridArrowTarget([], 0, 'ArrowDown', 4)).toBeUndefined();
  });
});

describe('calendarSortFixes', () => {
  it('needs nothing when already sorted by date created, newest first', () => {
    expect(calendarSortFixes('dateCreated', true)).toEqual([]);
  });

  it('switches to date created when sorted by something else', () => {
    expect(calendarSortFixes('dateAdded', true)).toEqual(['orderByDateCreated']);
  });

  it('flips an ascending direction', () => {
    expect(calendarSortFixes('dateCreated', false)).toEqual(['switchDirection']);
  });

  it('fixes both, ordering first', () => {
    expect(calendarSortFixes('name', false)).toEqual(['orderByDateCreated', 'switchDirection']);
  });
});

describe('groupIndexAt', () => {
  // virtuoso item counts per month: items 0-2, 3-4, 5-9
  const counts = [3, 2, 5];

  it('returns the group containing the item index', () => {
    expect(groupIndexAt(counts, 0)).toBe(0);
    expect(groupIndexAt(counts, 2)).toBe(0);
    expect(groupIndexAt(counts, 3)).toBe(1);
    expect(groupIndexAt(counts, 4)).toBe(1);
    expect(groupIndexAt(counts, 5)).toBe(2);
    expect(groupIndexAt(counts, 9)).toBe(2);
  });

  it('clamps indexes outside the list to the first/last group', () => {
    expect(groupIndexAt(counts, -4)).toBe(0);
    expect(groupIndexAt(counts, 99)).toBe(2);
  });

  it('returns 0 when there are no groups', () => {
    expect(groupIndexAt([], 3)).toBe(0);
  });
});
