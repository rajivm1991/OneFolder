import SysPath from 'path';

import { ClientFileSearchCriteria } from '../../entities/SearchCriteria';
import { isLocationFilter, isTagFilter, isUntaggedFilter } from '../Outliner/filter-utils';

export type ToolbarView = 'files' | 'map' | 'people' | 'duplicates';

export interface FilterSummary {
  /** The names of the tags (or Untagged) and folders chosen in the sidebar */
  names: string[];
  /** Search terms, a date range or anything else that is not a sidebar filter */
  otherCount: number;
}

/**
 * Sorts the search criteria into the sidebar filters, by name, and everything else.
 * @param tagName the name of a tag by id; unknown tags are shown as "Tag"
 */
export function summarizeFilters(
  criteria: readonly ClientFileSearchCriteria[],
  tagName: (id: string) => string | undefined,
): FilterSummary {
  const names: string[] = [];
  let otherCount = 0;
  for (const c of criteria) {
    if (isUntaggedFilter(c)) {
      names.push('Untagged');
    } else if (isTagFilter(c)) {
      names.push(tagName(c.value as string) ?? 'Tag');
    } else if (isLocationFilter(c)) {
      // The stored path ends with a separator, which would make the base name empty
      const path = String(c.value).replace(/[\\/]+$/, '');
      names.push(SysPath.basename(path) || path);
    } else {
      otherCount++;
    }
  }
  return { names, otherCount };
}

/**
 * What the toolbar says is shown.
 * - Map, People and Duplicates: the name of the view. Missing files: that.
 * - No filter at all: "All images". Exactly one sidebar filter and nothing else: its name.
 * - Anything more (several filters, a date, a search): "Filtered images".
 */
export function toolbarTitle(
  view: ToolbarView,
  showsMissing: boolean,
  { names, otherCount }: FilterSummary,
): string {
  if (showsMissing) {
    return 'Missing files';
  }
  if (view === 'map') {
    return 'Map';
  }
  if (view === 'people') {
    return 'People';
  }
  if (view === 'duplicates') {
    return 'Duplicates';
  }
  if (names.length === 0 && otherCount === 0) {
    return 'All images';
  }
  if (names.length === 1 && otherCount === 0) {
    return names[0];
  }
  return 'Filtered images';
}

export const itemCountLabel = (count: number): string =>
  `${count.toLocaleString()} ${count === 1 ? 'item' : 'items'}`;
