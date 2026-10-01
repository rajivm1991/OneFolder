/** Number of whole cells that fit in a row. Always at least 1 so callers never divide by zero. */
export function computeColumns(containerWidth: number, cellSize: number): number {
  if (!(cellSize > 0) || !Number.isFinite(containerWidth)) {
    return 1;
  }
  return Math.max(1, Math.floor(containerWidth / cellSize));
}

/** Split items into rows of `columns` items; the last row may be partial. */
export function chunkIntoRows<T>(items: T[], columns: number): T[][] {
  const size = Math.max(1, Math.floor(columns));
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    rows.push(items.slice(i, i + size));
  }
  return rows;
}

/** Index of the first row of group `groupIndex` when every group is chunked into rows of `columns`. */
export function rowStartIndex(groupSizes: number[], groupIndex: number, columns: number): number {
  const size = Math.max(1, Math.floor(columns));
  let rows = 0;
  for (let i = 0; i < groupIndex; i++) {
    rows += Math.ceil(groupSizes[i] / size);
  }
  return rows;
}

/**
 * New position in a flat, month-grouped list after an ArrowUp/ArrowDown press. Every month starts a new row, so
 * stepping by `columns` through the flat list would drift diagonally at month boundaries. Instead this keeps the
 * column, clamping to the end of a partial row, and crosses into the first/last row of the neighbouring month.
 * Use `columns` = 1 for a plain list. Returns undefined if the key is not handled or there is no row to move to.
 */
export function getGridArrowTarget(
  groupSizes: number[],
  position: number,
  key: string,
  columns: number,
): number | undefined {
  if (key !== 'ArrowUp' && key !== 'ArrowDown') {
    return undefined;
  }
  const step = Math.max(1, Math.floor(columns));

  let group = 0;
  let start = 0;
  while (group < groupSizes.length && position >= start + groupSizes[group]) {
    start += groupSizes[group];
    group++;
  }
  if (position < 0 || group >= groupSizes.length) {
    return undefined;
  }

  const size = groupSizes[group];
  const offset = position - start;
  const row = Math.floor(offset / step);
  const col = offset % step;
  const rowCount = Math.ceil(size / step);

  if (key === 'ArrowDown') {
    if (row + 1 < rowCount) {
      return start + Math.min((row + 1) * step + col, size - 1);
    }
    if (group + 1 >= groupSizes.length) {
      return undefined;
    }
    return start + size + Math.min(col, groupSizes[group + 1] - 1);
  }

  if (row > 0) {
    return start + (row - 1) * step + col;
  }
  if (group === 0) {
    return undefined;
  }
  const prevSize = groupSizes[group - 1];
  const prevStart = start - prevSize;
  const prevLastRow = Math.ceil(prevSize / step) - 1;
  return prevStart + Math.min(prevLastRow * step + col, prevSize - 1);
}

export type CalendarSortFix = 'orderByDateCreated' | 'switchDirection';

/**
 * The calendar view groups files by month, newest first, and keyboard/range selection walks the file list in its
 * sort order. Both only agree when the list is sorted by date created, descending. Returns what to change, in order.
 */
export function calendarSortFixes(orderBy: string, isDescending: boolean): CalendarSortFix[] {
  const fixes: CalendarSortFix[] = [];
  if (orderBy !== 'dateCreated') {
    fixes.push('orderByDateCreated');
  }
  if (!isDescending) {
    fixes.push('switchDirection');
  }
  return fixes;
}

/** Index of the group containing the virtuoso item at `itemIndex`; out-of-range indexes clamp to the first/last group. */
export function groupIndexAt(groupCounts: number[], itemIndex: number): number {
  let start = 0;
  for (let group = 0; group < groupCounts.length; group++) {
    start += groupCounts[group];
    if (itemIndex < start) {
      return group;
    }
  }
  return Math.max(0, groupCounts.length - 1);
}

/**
 * Virtuoso item index (file index in list mode, row index in grid mode) of the file at `position` in the flat,
 * month-grouped list. Undefined if the position is outside the list.
 */
export function itemIndexOfPosition(
  groupSizes: number[],
  position: number,
  columns: number,
): number | undefined {
  const total = groupSizes.reduce((sum, size) => sum + size, 0);
  if (position < 0 || position >= total) {
    return undefined;
  }
  const step = Math.max(1, Math.floor(columns));
  const group = groupIndexAt(groupSizes, position);
  const groupStart = groupSizes.slice(0, group).reduce((sum, size) => sum + size, 0);
  return rowStartIndex(groupSizes, group, step) + Math.floor((position - groupStart) / step);
}

/**
 * Where to align a scroll so `itemIndex` is fully in view, given the first/last item index currently rendered.
 * The first and last rendered items may be partly cut off, so they count as out of view. Undefined = don't scroll.
 */
export function scrollAlignFor(
  itemIndex: number,
  firstVisible: number,
  lastVisible: number,
): 'start' | 'end' | undefined {
  if (itemIndex <= firstVisible) {
    return 'start';
  }
  if (itemIndex >= lastVisible) {
    return 'end';
  }
  return undefined;
}
