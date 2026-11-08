import { ClientDateSearchCriteria, ClientFileSearchCriteria } from '../../entities/SearchCriteria';

/** A year, or one month of a year (`month` is 0-11). */
export type DateFilterValue = { year: number; month?: number };

const KEY = 'dateCreated';

/** The first day of the range and the first day after it, in local time. */
export function dateRange({ year, month }: DateFilterValue): { start: Date; end: Date } {
  if (month === undefined) {
    return { start: new Date(year, 0, 1), end: new Date(year + 1, 0, 1) };
  }
  return { start: new Date(year, month, 1), end: new Date(year, month + 1, 1) };
}

/** The two search criteria that make up a date filter: created on or after the start, and before the end. */
export function dateFilterCriteria(value: DateFilterValue): ClientDateSearchCriteria[] {
  const { start, end } = dateRange(value);
  return [
    new ClientDateSearchCriteria(KEY, start, 'greaterThanOrEquals'),
    new ClientDateSearchCriteria(KEY, end, 'smallerThan'),
  ];
}

function valueOfRange(start: Date, end: Date): DateFilterValue | undefined {
  if (start.getDate() !== 1) {
    return undefined;
  }
  const year = start.getFullYear();
  const month = start.getMonth();
  if (month === 0 && end.getTime() === new Date(year + 1, 0, 1).getTime()) {
    return { year };
  }
  return end.getTime() === new Date(year, month + 1, 1).getTime() ? { year, month } : undefined;
}

/**
 * Finds the pair of criteria that make up a date filter: created on or after the first of a month, and
 * before the end of exactly that year or month. Other date terms, such as a range typed in by hand in the
 * advanced search, are not part of the filter and are left alone.
 */
export function findDateFilter(
  criteria: readonly ClientFileSearchCriteria[],
):
  | { value: DateFilterValue; criteria: [ClientDateSearchCriteria, ClientDateSearchCriteria] }
  | undefined {
  const created = criteria.filter(
    (c): c is ClientDateSearchCriteria => c instanceof ClientDateSearchCriteria && c.key === KEY,
  );
  for (const from of created.filter((c) => c.operator === 'greaterThanOrEquals')) {
    for (const until of created.filter((c) => c.operator === 'smallerThan')) {
      const value = valueOfRange(from.value, until.value);
      if (value) {
        return { value, criteria: [from, until] };
      }
    }
  }
  return undefined;
}

/** The year or month currently filtered on, or undefined when there is no date filter. */
export function readDateFilter(
  criteria: readonly ClientFileSearchCriteria[],
): DateFilterValue | undefined {
  return findDateFilter(criteria)?.value;
}

/** The criteria without the date filter's own pair; everything else, including other date terms, stays. */
export function withoutDateFilter(
  criteria: readonly ClientFileSearchCriteria[],
): ClientFileSearchCriteria[] {
  const found = findDateFilter(criteria);
  return found
    ? criteria.filter((c) => !found.criteria.includes(c as ClientDateSearchCriteria))
    : [...criteria];
}

/**
 * Where an arrow key moves focus in a grid of `total` cells laid out in rows of `columns`.
 * Returns the same index when the move would leave the grid.
 */
export function gridMove(index: number, key: string, columns: number, total: number): number {
  const delta =
    key === 'ArrowLeft'
      ? -1
      : key === 'ArrowRight'
      ? 1
      : key === 'ArrowUp'
      ? -columns
      : key === 'ArrowDown'
      ? columns
      : 0;
  const next = index + delta;
  const crossesRow =
    (key === 'ArrowLeft' || key === 'ArrowRight') &&
    Math.floor(next / columns) !== Math.floor(index / columns);
  return delta === 0 || next < 0 || next >= total || crossesRow ? index : next;
}

export const MONTH_LABELS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/** Short text for the toolbar button, for example "2024" or "Mar 2024". */
export function dateFilterLabel(value: DateFilterValue | undefined): string {
  if (!value) {
    return 'Date';
  }
  return value.month === undefined
    ? String(value.year)
    : `${MONTH_LABELS[value.month]} ${value.year}`;
}
