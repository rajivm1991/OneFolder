import { observer } from 'mobx-react-lite';
import React, { useCallback, useEffect, useMemo, useState } from 'react';

import { MonthCount } from 'src/api/data-storage';
import { IconSet } from 'widgets';
import { Flyout } from 'widgets/popovers';
import { ToolbarButton } from 'widgets/toolbar';
import { useStore } from '../../contexts/StoreContext';
import {
  DateFilterValue,
  dateFilterCriteria,
  dateFilterLabel,
  isDateFilterCriterion,
  MONTH_LABELS,
  readDateFilter,
} from './date-filter-utils';

/** How many year chips fit in a row before the arrows are needed */
const YEARS_PER_PAGE = 6;

const sameValue = (a: DateFilterValue | undefined, b: DateFilterValue) =>
  a !== undefined && a.year === b.year && a.month === b.month;

/** A toolbar button that opens a popover to narrow the library to one year or one month. */
const DateFilter = observer(() => {
  const { uiStore, fileStore } = useStore();
  const [isOpen, setIsOpen] = useState(false);
  const [counts, setCounts] = useState<MonthCount[]>([]);
  const [yearPage, setYearPage] = useState(0);
  const [browsedYear, setBrowsedYear] = useState<number | undefined>(undefined);

  const active = readDateFilter(uiStore.searchCriteriaList);
  const hasUnreadableDateFilter =
    active === undefined && uiStore.searchCriteriaList.some(isDateFilterCriterion);

  // Counts are read when the popover opens, so they are current without having to watch the library
  useEffect(() => {
    if (!isOpen) {
      return;
    }
    let cancelled = false;
    fileStore
      .fetchMonthCounts()
      .then((result) => {
        if (!cancelled) {
          setCounts(result);
        }
      })
      .catch((err) => console.error('Could not count files per month', err));
    return () => {
      cancelled = true;
    };
  }, [isOpen, fileStore]);

  // Years that have files, newest first
  const years = useMemo(() => {
    const set = new Set(counts.map((c) => c.year));
    if (active) {
      set.add(active.year);
    }
    return Array.from(set).sort((a, b) => b - a);
  }, [counts, active]);

  const selectedYear = browsedYear ?? active?.year ?? years[0];
  const pageCount = Math.max(1, Math.ceil(years.length / YEARS_PER_PAGE));
  const page = Math.min(yearPage, pageCount - 1);
  const visibleYears = years.slice(page * YEARS_PER_PAGE, (page + 1) * YEARS_PER_PAGE);

  const monthCount = useCallback(
    (year: number, month: number) =>
      counts.find((c) => c.year === year && c.month === month)?.count ?? 0,
    [counts],
  );
  const yearCount = (year: number) =>
    counts.filter((c) => c.year === year).reduce((sum, c) => sum + c.count, 0);

  const apply = (value: DateFilterValue) => {
    const others = uiStore.searchCriteriaList.filter((crit) => !isDateFilterCriterion(crit));
    // Toggling the value that is already active clears it
    if (sameValue(active, value)) {
      uiStore.replaceSearchCriterias(others);
    } else {
      uiStore.replaceSearchCriterias([...others, ...dateFilterCriteria(value)]);
    }
  };

  const clear = () => {
    uiStore.replaceSearchCriterias(
      uiStore.searchCriteriaList.filter((crit) => !isDateFilterCriterion(crit)),
    );
    setBrowsedYear(undefined);
  };

  const hasDateFilter = active !== undefined || hasUnreadableDateFilter;
  // With "match any", the two halves of the range would be combined with OR and match every file
  const blockedByMatchAny = uiStore.searchMatchAny;

  return (
    <Flyout
      isOpen={isOpen}
      cancel={() => setIsOpen(false)}
      label="Filter by date"
      placement="bottom"
      target={(ref) => (
        <div ref={ref} className="date-filter-target">
          <ToolbarButton
            icon={IconSet.FILTER_DATE}
            text={dateFilterLabel(active)}
            tooltip="Filter by year or month"
            onClick={() => setIsOpen((open) => !open)}
            pressed={hasDateFilter}
            isCollapsible={false}
          />
        </div>
      )}
    >
      <div className="date-filter">
        {blockedByMatchAny && (
          <p className="date-filter__notice">
            Search is set to match any term, which cannot be combined with a date range.{' '}
            <button
              type="button"
              onClick={() => {
                uiStore.toggleSearchMatchAny();
              }}
            >
              Match all terms
            </button>
          </p>
        )}

        {years.length === 0 ? (
          <p className="date-filter__empty">No photos yet</p>
        ) : (
          <>
            <div className="date-filter__years" role="group" aria-label="Year">
              <button
                type="button"
                aria-label="Newer years"
                disabled={page === 0}
                onClick={() => setYearPage(page - 1)}
              >
                {IconSet.ARROW_LEFT}
              </button>
              {visibleYears.map((year) => (
                <button
                  type="button"
                  key={year}
                  className="date-filter__year"
                  aria-pressed={selectedYear === year}
                  onClick={() => setBrowsedYear(year)}
                >
                  {year}
                </button>
              ))}
              <button
                type="button"
                aria-label="Earlier years"
                disabled={page >= pageCount - 1}
                onClick={() => setYearPage(page + 1)}
              >
                {IconSet.ARROW_RIGHT}
              </button>
            </div>

            {selectedYear !== undefined && (
              <>
                <button
                  type="button"
                  className="date-filter__whole-year"
                  aria-pressed={sameValue(active, { year: selectedYear })}
                  disabled={blockedByMatchAny || yearCount(selectedYear) === 0}
                  onClick={() => apply({ year: selectedYear })}
                >
                  <span>Whole year</span>
                  <span className="date-filter__count">
                    {yearCount(selectedYear).toLocaleString()}
                  </span>
                </button>

                <div
                  className="date-filter__months"
                  role="group"
                  aria-label={`Months of ${selectedYear}`}
                >
                  {MONTH_LABELS.map((label, month) => {
                    const count = monthCount(selectedYear, month);
                    const isActive = sameValue(active, { year: selectedYear, month });
                    return (
                      <button
                        type="button"
                        key={label}
                        className="date-filter__month"
                        aria-pressed={isActive}
                        disabled={blockedByMatchAny || (count === 0 && !isActive)}
                        onClick={() => apply({ year: selectedYear, month })}
                      >
                        <span>{label}</span>
                        <span className="date-filter__count">
                          {count === 0 ? 'No photos' : count.toLocaleString()}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </>
        )}

        <footer className="date-filter__footer">
          <button type="button" onClick={clear} disabled={!hasDateFilter}>
            Clear
          </button>
        </footer>
      </div>
    </Flyout>
  );
});

export default DateFilter;
