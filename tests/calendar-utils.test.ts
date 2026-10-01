import {
  chunkIntoRows,
  computeColumns,
  getArrowTarget,
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

describe('getArrowTarget', () => {
  it('moves by columns for ArrowDown / ArrowUp', () => {
    expect(getArrowTarget(1, 20, 'ArrowDown', 4)).toBe(5);
    expect(getArrowTarget(9, 20, 'ArrowUp', 4)).toBe(5);
  });

  it('moves by 1 when columns is 1 (list mode)', () => {
    expect(getArrowTarget(3, 10, 'ArrowDown', 1)).toBe(4);
    expect(getArrowTarget(3, 10, 'ArrowUp', 1)).toBe(2);
  });

  it('stays put (undefined) when the move would leave the list', () => {
    expect(getArrowTarget(0, 10, 'ArrowUp', 1)).toBeUndefined();
    expect(getArrowTarget(9, 10, 'ArrowDown', 1)).toBeUndefined();
    expect(getArrowTarget(2, 10, 'ArrowUp', 4)).toBeUndefined();
    expect(getArrowTarget(8, 10, 'ArrowDown', 4)).toBeUndefined();
  });

  it('ignores other keys', () => {
    expect(getArrowTarget(3, 10, 'ArrowLeft', 4)).toBeUndefined();
    expect(getArrowTarget(3, 10, 'a', 4)).toBeUndefined();
  });
});
