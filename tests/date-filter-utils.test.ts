import { filterLambda } from '../src/backend/backend';
import {
  dateFilterCriteria,
  dateFilterLabel,
  dateRange,
  isDateFilterCriterion,
  readDateFilter,
} from '../src/frontend/containers/AppToolbar/date-filter-utils';
import {
  ClientDateSearchCriteria,
  ClientStringSearchCriteria,
} from '../src/frontend/entities/SearchCriteria';

describe('dateRange', () => {
  it('spans a whole year, end exclusive', () => {
    const { start, end } = dateRange({ year: 2024 });
    expect(start).toEqual(new Date(2024, 0, 1));
    expect(end).toEqual(new Date(2025, 0, 1));
  });

  it('spans one month, rolling December into the next year', () => {
    expect(dateRange({ year: 2024, month: 2 })).toEqual({
      start: new Date(2024, 2, 1),
      end: new Date(2024, 3, 1),
    });
    expect(dateRange({ year: 2024, month: 11 })).toEqual({
      start: new Date(2024, 11, 1),
      end: new Date(2025, 0, 1),
    });
  });
});

describe('readDateFilter', () => {
  it('reads back a year and a month it created', () => {
    expect(readDateFilter(dateFilterCriteria({ year: 2023 }))).toEqual({ year: 2023 });
    expect(readDateFilter(dateFilterCriteria({ year: 2023, month: 11 }))).toEqual({
      year: 2023,
      month: 11,
    });
  });

  it('ignores other criteria around it', () => {
    const other = new ClientStringSearchCriteria('name', 'beach', 'contains');
    expect(readDateFilter([other, ...dateFilterCriteria({ year: 2022, month: 0 })])).toEqual({
      year: 2022,
      month: 0,
    });
  });

  it('returns undefined without a date filter', () => {
    expect(readDateFilter([])).toBeUndefined();
  });

  it('returns undefined for a hand-made range that is not a whole year or month', () => {
    const crits = [
      new ClientDateSearchCriteria('dateCreated', new Date(2024, 0, 1), 'greaterThanOrEquals'),
      new ClientDateSearchCriteria('dateCreated', new Date(2024, 4, 1), 'smallerThan'),
    ];
    expect(readDateFilter(crits)).toBeUndefined();
  });

  it('returns undefined when only one half is present', () => {
    const [from] = dateFilterCriteria({ year: 2024 });
    expect(readDateFilter([from])).toBeUndefined();
  });
});

describe('isDateFilterCriterion', () => {
  it('matches only the created-date range pair', () => {
    const [from, until] = dateFilterCriteria({ year: 2024 });
    expect(isDateFilterCriterion(from)).toBe(true);
    expect(isDateFilterCriterion(until)).toBe(true);
    expect(
      isDateFilterCriterion(
        new ClientDateSearchCriteria('dateModified', new Date(), 'smallerThan'),
      ),
    ).toBe(false);
    expect(
      isDateFilterCriterion(new ClientDateSearchCriteria('dateCreated', new Date(), 'equals')),
    ).toBe(false);
  });
});

describe('date filter criteria against the search filter', () => {
  const lambdas = (value: { year: number; month?: number }) =>
    dateFilterCriteria(value).map((c) => filterLambda(c.toCondition() as any));
  const matches = (value: { year: number; month?: number }, date: Date) =>
    lambdas(value).every((fn) => fn({ dateCreated: date }));

  it('includes the first and last moments of a month and excludes the neighbours', () => {
    const march = { year: 2024, month: 2 };
    expect(matches(march, new Date(2024, 2, 1, 0, 0, 0))).toBe(true);
    expect(matches(march, new Date(2024, 2, 31, 23, 59, 59))).toBe(true);
    expect(matches(march, new Date(2024, 1, 29, 23, 59, 59))).toBe(false);
    expect(matches(march, new Date(2024, 3, 1, 0, 0, 0))).toBe(false);
  });

  it('includes all of a year and nothing outside it', () => {
    const year = { year: 2023 };
    expect(matches(year, new Date(2023, 0, 1))).toBe(true);
    expect(matches(year, new Date(2023, 11, 31, 23, 59, 59))).toBe(true);
    expect(matches(year, new Date(2022, 11, 31, 23, 59, 59))).toBe(false);
    expect(matches(year, new Date(2024, 0, 1))).toBe(false);
  });
});

describe('dateFilterLabel', () => {
  it('describes the active filter', () => {
    expect(dateFilterLabel(undefined)).toBe('Date');
    expect(dateFilterLabel({ year: 2024 })).toBe('2024');
    expect(dateFilterLabel({ year: 2024, month: 2 })).toBe('Mar 2024');
  });
});
