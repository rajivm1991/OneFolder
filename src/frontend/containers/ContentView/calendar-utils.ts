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
 * New position in a flat list of `total` items after an ArrowUp/ArrowDown press, moving by `columns`
 * (use 1 for a plain list). Returns undefined if the key is not handled or the move would leave the list.
 */
export function getArrowTarget(
  position: number,
  total: number,
  key: string,
  columns: number,
): number | undefined {
  const step = Math.max(1, Math.floor(columns));
  if (key === 'ArrowUp' && position - step >= 0) {
    return position - step;
  }
  if (key === 'ArrowDown' && position + step <= total - 1) {
    return position + step;
  }
  return undefined;
}
