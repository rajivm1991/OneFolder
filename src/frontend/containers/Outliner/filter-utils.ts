import SysPath from 'path';

import type UiStore from '../../stores/UiStore';
import {
  ClientFileSearchCriteria,
  ClientStringSearchCriteria,
  ClientTagSearchCriteria,
} from '../../entities/SearchCriteria';

/** Cmd on macOS, Ctrl elsewhere: adds to or removes from the selection instead of replacing it */
export const isAdditiveClick = (e: { ctrlKey: boolean; metaKey: boolean }): boolean =>
  e.ctrlKey || e.metaKey;

/**
 * The next list of search criteria after clicking a row of a sidebar filter group (Tags or Locations).
 *
 * Only the criteria of that group change; all other criteria (the other group, a date range, typed terms) stay.
 * - Plain click: the row becomes the only selected row of its group. Clicking the only selected row clears it.
 * - Additive click (Cmd/Ctrl): the row is added to the group, or removed if it was already in it.
 */
export function toggleInGroup<C>(
  all: readonly C[],
  inGroup: (c: C) => boolean,
  isClicked: (c: C) => boolean,
  create: () => C,
  additive: boolean,
): C[] {
  const others = all.filter((c) => !inGroup(c));
  const group = all.filter(inGroup);
  const existing = group.find(isClicked);

  let next: C[];
  if (additive) {
    next = existing ? group.filter((c) => c !== existing) : [...group, create()];
  } else {
    next = existing && group.length === 1 ? [] : [create()];
  }
  return [...others, ...next];
}

/** A tag, or Untagged (no value), chosen from the Tags filter. Other tag terms, like "does not have", are not part of it. */
export const isTagFilter = (c: ClientFileSearchCriteria): c is ClientTagSearchCriteria =>
  c instanceof ClientTagSearchCriteria && c.key === 'tags' && c.operator === 'containsRecursively';

export const isUntaggedFilter = (c: ClientFileSearchCriteria): boolean =>
  isTagFilter(c) && !c.value;

export const tagFilterCriteria = (tagId?: string) => new ClientTagSearchCriteria('tags', tagId);

/** Add an additional / or \ in order to enforce files only in the specific directory are found, not in those starting with same name */
export const pathAsSearchPath = (path: string): string => `${path}${SysPath.sep}`;

/** Pick a tag (or Untagged, without an id) in the Tags filter */
export function toggleTagFilter(uiStore: UiStore, tagId: string | undefined, additive: boolean) {
  uiStore.replaceSearchCriterias(
    toggleInGroup(
      [...uiStore.searchCriteriaList],
      isTagFilter,
      (c) => (c as ClientTagSearchCriteria).value === tagId,
      () => tagFilterCriteria(tagId),
      additive,
    ),
  );
}

/** Show everything again, for tags only */
export function clearTagFilters(uiStore: UiStore) {
  uiStore.replaceSearchCriterias(uiStore.searchCriteriaList.filter((c) => !isTagFilter(c)));
}

/** Pick a folder in the Locations filter */
export function toggleLocationFilter(uiStore: UiStore, path: string, additive: boolean) {
  const searchPath = pathAsSearchPath(path);
  uiStore.replaceSearchCriterias(
    toggleInGroup(
      [...uiStore.searchCriteriaList],
      isLocationFilter,
      (c) => (c as ClientStringSearchCriteria).value === searchPath,
      () => locationFilterCriteria(path),
      additive,
    ),
  );
}

/** A folder chosen from the Locations filter */
export const isLocationFilter = (c: ClientFileSearchCriteria): c is ClientStringSearchCriteria =>
  c instanceof ClientStringSearchCriteria &&
  c.key === 'absolutePath' &&
  c.operator === 'startsWith';

export const locationFilterCriteria = (path: string) =>
  new ClientStringSearchCriteria('absolutePath', pathAsSearchPath(path), 'startsWith');
