import {
  ClientDateSearchCriteria,
  ClientFileSearchCriteria,
  ClientStringSearchCriteria,
  ClientTagSearchCriteria,
} from '../src/frontend/entities/SearchCriteria';
import {
  clearTagFilters,
  isAdditiveClick,
  isLocationFilter,
  isTagFilter,
  isUntaggedFilter,
  toggleInGroup,
  toggleLocationFilter,
  toggleTagFilter,
} from '../src/frontend/containers/Outliner/filter-utils';

/** Just enough of the UiStore for the filter helpers */
const fakeUiStore = (initial: ClientFileSearchCriteria[] = []) => {
  const store = {
    searchCriteriaList: initial,
    replaceSearchCriterias(next: ClientFileSearchCriteria[]) {
      store.searchCriteriaList = next;
    },
  };
  return store as any;
};

const tagValues = (list: ClientFileSearchCriteria[]) =>
  list.filter(isTagFilter).map((c) => (c as ClientTagSearchCriteria).value);

describe('toggleInGroup', () => {
  const isEven = (n: number) => n % 2 === 0;

  it('plain click makes the row the only one of its group, and keeps other rows', () => {
    expect(
      toggleInGroup(
        [1, 2, 4],
        isEven,
        (n) => n === 4,
        () => 4,
        false,
      ),
    ).toEqual([1, 4]);
    expect(
      toggleInGroup(
        [1, 2],
        isEven,
        (n) => n === 6,
        () => 6,
        false,
      ),
    ).toEqual([1, 6]);
  });

  it('plain click on the only selected row clears it', () => {
    expect(
      toggleInGroup(
        [1, 2],
        isEven,
        (n) => n === 2,
        () => 2,
        false,
      ),
    ).toEqual([1]);
  });

  it('additive click adds a row, or removes one that is already there', () => {
    expect(
      toggleInGroup(
        [1, 2],
        isEven,
        (n) => n === 4,
        () => 4,
        true,
      ),
    ).toEqual([1, 2, 4]);
    expect(
      toggleInGroup(
        [1, 2, 4],
        isEven,
        (n) => n === 2,
        () => 2,
        true,
      ),
    ).toEqual([1, 4]);
  });
});

describe('isAdditiveClick', () => {
  it('is Cmd or Ctrl', () => {
    expect(isAdditiveClick({ ctrlKey: false, metaKey: true })).toBe(true);
    expect(isAdditiveClick({ ctrlKey: true, metaKey: false })).toBe(true);
    expect(isAdditiveClick({ ctrlKey: false, metaKey: false })).toBe(false);
  });
});

describe('tag filter', () => {
  it('chooses one tag, then another, replacing the first', () => {
    const ui = fakeUiStore();
    toggleTagFilter(ui, 'a', false);
    expect(tagValues(ui.searchCriteriaList)).toEqual(['a']);
    toggleTagFilter(ui, 'b', false);
    expect(tagValues(ui.searchCriteriaList)).toEqual(['b']);
  });

  it('clicking the chosen tag again shows everything', () => {
    const ui = fakeUiStore();
    toggleTagFilter(ui, 'a', false);
    toggleTagFilter(ui, 'a', false);
    expect(ui.searchCriteriaList).toEqual([]);
  });

  it('Cmd+click chooses several tags and removes one again', () => {
    const ui = fakeUiStore();
    toggleTagFilter(ui, 'a', false);
    toggleTagFilter(ui, 'b', true);
    expect(tagValues(ui.searchCriteriaList)).toEqual(['a', 'b']);
    toggleTagFilter(ui, 'a', true);
    expect(tagValues(ui.searchCriteriaList)).toEqual(['b']);
  });

  it('Untagged is part of the tag group', () => {
    const ui = fakeUiStore();
    toggleTagFilter(ui, 'a', false);
    toggleTagFilter(ui, undefined, false);
    expect(ui.searchCriteriaList.filter(isUntaggedFilter)).toHaveLength(1);
    expect(tagValues(ui.searchCriteriaList)).toEqual([undefined]);
  });

  it('leaves locations, a date range and a "does not have" tag term alone', () => {
    const date = new ClientDateSearchCriteria(
      'dateCreated',
      new Date(2024, 0, 1),
      'greaterThanOrEquals',
    );
    const place = new ClientStringSearchCriteria('absolutePath', '/photos/', 'startsWith');
    const notTag = new ClientTagSearchCriteria('tags', 'x', 'containsNotRecursively');
    const ui = fakeUiStore([date, place, notTag]);

    toggleTagFilter(ui, 'a', false);
    toggleTagFilter(ui, 'b', false);

    expect(ui.searchCriteriaList).toContain(date);
    expect(ui.searchCriteriaList).toContain(place);
    expect(ui.searchCriteriaList).toContain(notTag);
    expect(tagValues(ui.searchCriteriaList)).toEqual(['b']);
  });

  it('clearTagFilters removes only the tag filters', () => {
    const place = new ClientStringSearchCriteria('absolutePath', '/photos/', 'startsWith');
    const ui = fakeUiStore([new ClientTagSearchCriteria('tags', 'a'), place]);
    clearTagFilters(ui);
    expect(ui.searchCriteriaList).toEqual([place]);
  });
});

describe('location filter', () => {
  it('chooses one folder, then another, and Cmd+click adds a second', () => {
    const ui = fakeUiStore();
    toggleLocationFilter(ui, '/a', false);
    toggleLocationFilter(ui, '/b', false);
    expect(ui.searchCriteriaList.filter(isLocationFilter)).toHaveLength(1);
    toggleLocationFilter(ui, '/c', true);
    expect(ui.searchCriteriaList.filter(isLocationFilter)).toHaveLength(2);
  });

  it('clicking the chosen folder again clears it, and tags are untouched', () => {
    const tag = new ClientTagSearchCriteria('tags', 'a');
    const ui = fakeUiStore([tag]);
    toggleLocationFilter(ui, '/a', false);
    toggleLocationFilter(ui, '/a', false);
    expect(ui.searchCriteriaList).toEqual([tag]);
  });
});
