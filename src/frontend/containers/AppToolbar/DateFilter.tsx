import { observer } from 'mobx-react-lite';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { MonthCount } from 'src/api/data-storage';
import { Flyout } from 'widgets/popovers';
import { useStore } from '../../contexts/StoreContext';
import {
  DateFilterValue,
  dateFilterCriteria,
  dateFilterLabel,
  gridMove,
  MONTH_LABELS,
  readDateFilter,
  withoutDateFilter,
} from './date-filter-utils';

/** How many year chips fit in a row before the arrows are needed */
const YEARS_PER_PAGE = 6;
const MONTH_COLUMNS = 4;

const sameValue = (a: DateFilterValue | undefined, b: DateFilterValue) =>
  a !== undefined && a.year === b.year && a.month === b.month;

/** A toolbar button that opens a popover to narrow the library to one year or one month. */
const DateFilter = observer(() => {
  const { uiStore, fileStore } = useStore();
  const [isOpen, setIsOpen] = useState(false);
  // undefined while loading
  const [counts, setCounts] = useState<MonthCount[] | undefined>(undefined);
  const [countsFailed, setCountsFailed] = useState(false);
  // The year chosen while browsing, and the page of year chips, both only until the popover is closed.
  // Without them the popover follows the active filter.
  const [browsedYear, setBrowsedYear] = useState<number | undefined>(undefined);
  const [yearPageOverride, setYearPageOverride] = useState<number | undefined>(undefined);
  const targetRef = useRef<HTMLDivElement | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const active = readDateFilter(uiStore.searchCriteriaList);

  // Counts are read when the popover opens, and again if the number of files changes while it is open
  const totalFiles = fileStore.numTotalFiles;
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
          setCountsFailed(false);
        }
      })
      .catch((err) => {
        console.error('Could not count files per month', err);
        if (!cancelled) {
          setCountsFailed(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, fileStore, totalFiles]);

  // Move focus into the popover when it opens: the popover is only dismissed from focus leaving it
  useLayoutEffect(() => {
    if (isOpen) {
      popoverRef.current?.focus();
    }
  }, [isOpen]);

  const monthCounts = counts ?? [];

  // Years that have files, newest first
  const years = useMemo(() => {
    const set = new Set(monthCounts.map((c) => c.year));
    if (active) {
      set.add(active.year);
    }
    return Array.from(set).sort((a, b) => b - a);
  }, [monthCounts, active]);

  const selectedYear = browsedYear ?? active?.year ?? years[0];
  const pageCount = Math.max(1, Math.ceil(years.length / YEARS_PER_PAGE));
  const selectedYearPage =
    selectedYear === undefined
      ? 0
      : Math.floor(Math.max(0, years.indexOf(selectedYear)) / YEARS_PER_PAGE);
  const page = Math.min(yearPageOverride ?? selectedYearPage, pageCount - 1);
  const visibleYears = years.slice(page * YEARS_PER_PAGE, (page + 1) * YEARS_PER_PAGE);

  const monthCount = useCallback(
    (year: number, month: number) =>
      monthCounts.find((c) => c.year === year && c.month === month)?.count ?? 0,
    [monthCounts],
  );
  const yearCount = (year: number) =>
    monthCounts.filter((c) => c.year === year).reduce((sum, c) => sum + c.count, 0);

  const toggleOpen = () => {
    if (!isOpen) {
      setBrowsedYear(undefined);
      setYearPageOverride(undefined);
    }
    setIsOpen(!isOpen);
  };

  const apply = (value: DateFilterValue) => {
    // Only the pair this filter made is replaced; other terms, including hand-typed date terms, stay
    const others = withoutDateFilter(uiStore.searchCriteriaList);
    // Choosing the value that is already active clears it
    if (sameValue(active, value)) {
      uiStore.replaceSearchCriterias(others);
    } else {
      uiStore.replaceSearchCriterias([...others, ...dateFilterCriteria(value)]);
    }
  };

  const clear = () => {
    uiStore.replaceSearchCriterias(withoutDateFilter(uiStore.searchCriteriaList));
    setBrowsedYear(undefined);
    setYearPageOverride(undefined);
  };

  // With "match any", the two halves of the range would be combined with OR and match every file
  const blockedByMatchAny = uiStore.searchMatchAny;

  const handleMonthKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const cells = Array.from(
      e.currentTarget.querySelectorAll<HTMLButtonElement>('.date-filter__month'),
    );
    let index = cells.indexOf(document.activeElement as HTMLButtonElement);
    if (index === -1) {
      return;
    }
    // Skip over disabled months in the direction of travel
    for (;;) {
      const next = gridMove(index, e.key, MONTH_COLUMNS, cells.length);
      if (next === index) {
        return;
      }
      if (!cells[next].disabled) {
        e.preventDefault();
        cells[next].focus();
        return;
      }
      index = next;
    }
  };

  const buttonTooltip =
    active && blockedByMatchAny
      ? 'The date filter has no effect while search matches any term'
      : 'Filter by year or month';

  return (
    <Flyout
      isOpen={isOpen}
      cancel={() => setIsOpen(false)}
      ignoreCloseForElementOnBlur={targetRef.current?.querySelector('button') ?? undefined}
      label="Filter by date"
      placement="bottom"
      target={(ref) => (
        <div
          ref={(element: HTMLDivElement | null) => {
            ref(element);
            targetRef.current = element;
          }}
          className="date-filter-target"
          tabIndex={-1}
          // Flyout hands focus back to this wrapper on Escape; pass it on to the real button
          onFocus={(e) => {
            if (e.target === e.currentTarget) {
              targetRef.current?.querySelector('button')?.focus();
            }
          }}
        >
          <button
            type="button"
            className={`date-filter__trigger${active !== undefined ? ' is-active' : ''}`}
            aria-haspopup="dialog"
            aria-expanded={isOpen}
            title={buttonTooltip}
            onClick={toggleOpen}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.9"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect x="3" y="4" width="18" height="17" rx="3" />
              <path d="M3 10h18M8 2v4M16 2v4" />
            </svg>
            {dateFilterLabel(active)}
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
        </div>
      )}
    >
      <div className="date-filter" ref={popoverRef} tabIndex={-1}>
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

        {countsFailed && counts === undefined ? (
          <p className="date-filter__empty">Could not load the number of photos per month</p>
        ) : counts === undefined ? (
          <p className="date-filter__empty">Loading…</p>
        ) : years.length === 0 ? (
          <p className="date-filter__empty">No photos yet</p>
        ) : (
          <>
            <div className="date-filter__years" role="group" aria-label="Year">
              <button
                type="button"
                className="date-filter__icon-btn"
                aria-label="Earlier years"
                disabled={page >= pageCount - 1}
                onClick={() => setYearPageOverride(page + 1)}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M15 6l-6 6 6 6" />
                </svg>
              </button>
              {/* Oldest first, so the newest year is at the right */}
              {[...visibleYears].reverse().map((year) => (
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
              {/* Only after going back: the way to the newer years again (the mockup shows the newest page) */}
              {page > 0 && (
                <button
                  type="button"
                  className="date-filter__icon-btn"
                  aria-label="Later years"
                  onClick={() => setYearPageOverride(page - 1)}
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M9 6l6 6-6 6" />
                  </svg>
                </button>
              )}
            </div>

            {selectedYear !== undefined && (
              <>
                <button
                  type="button"
                  className="date-filter__whole-year"
                  aria-pressed={sameValue(active, { year: selectedYear })}
                  disabled={
                    blockedByMatchAny ||
                    (yearCount(selectedYear) === 0 && !sameValue(active, { year: selectedYear }))
                  }
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
                  onKeyDown={handleMonthKeyDown}
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
          <span className="date-filter__summary">
            {active !== undefined &&
              `Showing ${fileStore.fileList.length.toLocaleString()} ${
                fileStore.fileList.length === 1 ? 'item' : 'items'
              } from ${dateFilterLabel(active)}`}
          </span>
          <button
            type="button"
            className="date-filter__clear"
            onClick={clear}
            disabled={active === undefined}
          >
            Clear
          </button>
        </footer>
      </div>
    </Flyout>
  );
});

export default DateFilter;
