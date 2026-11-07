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

function isFromCreated(crit: ClientFileSearchCriteria): crit is ClientDateSearchCriteria {
  return crit instanceof ClientDateSearchCriteria && crit.key === KEY;
}

/** Whether a criterion is one of the two that the date filter adds (and removes again on Clear). */
export function isDateFilterCriterion(crit: ClientFileSearchCriteria): boolean {
  return (
    isFromCreated(crit) &&
    (crit.operator === 'greaterThanOrEquals' || crit.operator === 'smallerThan')
  );
}

/**
 * The year or month currently filtered on, or undefined when the criteria are not exactly the pair
 * this filter creates (for instance a range typed in by hand in the advanced search).
 */
export function readDateFilter(
  criteria: readonly ClientFileSearchCriteria[],
): DateFilterValue | undefined {
  const dated = criteria.filter(isDateFilterCriterion) as ClientDateSearchCriteria[];
  const from = dated.find((c) => c.operator === 'greaterThanOrEquals');
  const until = dated.find((c) => c.operator === 'smallerThan');
  if (dated.length !== 2 || !from || !until) {
    return undefined;
  }
  const { value: start } = from;
  const { value: end } = until;
  const year = start.getFullYear();
  const month = start.getMonth();
  const isFirstOfMonth = start.getDate() === 1;
  if (!isFirstOfMonth) {
    return undefined;
  }
  const isWholeYear = month === 0 && end.getTime() === new Date(year + 1, 0, 1).getTime();
  if (isWholeYear) {
    return { year };
  }
  const isOneMonth = end.getTime() === new Date(year, month + 1, 1).getTime();
  return isOneMonth ? { year, month } : undefined;
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
