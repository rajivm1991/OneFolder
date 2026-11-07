import { filterLambda } from '../src/backend/backend';
import { ConditionDTO } from '../src/api/data-storage-search';
import { FileDTO } from '../src/api/file';
import {
  ClientStringSearchCriteria,
  criteriaToConditions,
} from '../src/frontend/entities/SearchCriteria';
import {
  locationFilterCriteria,
  tagFilterCriteria,
} from '../src/frontend/containers/Outliner/filter-utils';

// Just enough of the root store to turn a tag into its tree of tags: a tag without sub-tags
const rootStore = {
  tagStore: { get: (id: string) => ({ getSubTree: () => [{ id }] }) },
} as any;

const file = (path: string, tags: string[]): FileDTO => ({ absolutePath: path, tags } as FileDTO);

const matches = (conditions: ConditionDTO<FileDTO>[], f: FileDTO) =>
  conditions.every((c) => filterLambda(c)(f));

describe('criteriaToConditions', () => {
  const files = {
    aT1: file('/photos/a/1.jpg', ['t1']),
    bT2: file('/photos/b/2.jpg', ['t2']),
    bT3: file('/photos/b/3.jpg', ['t3']),
    cT1: file('/photos/c/4.jpg', ['t1']),
    aNone: file('/photos/a/5.jpg', []),
  };

  it('treats several folders as alternatives', () => {
    const conditions = criteriaToConditions(
      [locationFilterCriteria('/photos/a'), locationFilterCriteria('/photos/b')],
      rootStore,
      false,
    );
    expect(conditions).toHaveLength(1);
    expect(matches(conditions, files.aT1)).toBe(true);
    expect(matches(conditions, files.bT2)).toBe(true);
    expect(matches(conditions, files.cT1)).toBe(false);
  });

  it('treats several tags as alternatives', () => {
    const conditions = criteriaToConditions(
      [tagFilterCriteria('t1'), tagFilterCriteria('t2')],
      rootStore,
      false,
    );
    expect(matches(conditions, files.aT1)).toBe(true);
    expect(matches(conditions, files.bT2)).toBe(true);
    expect(matches(conditions, files.bT3)).toBe(false);
  });

  it('Untagged is an alternative next to tags', () => {
    const conditions = criteriaToConditions(
      [tagFilterCriteria(undefined), tagFilterCriteria('t2')],
      rootStore,
      false,
    );
    expect(matches(conditions, files.aNone)).toBe(true);
    expect(matches(conditions, files.bT2)).toBe(true);
    expect(matches(conditions, files.aT1)).toBe(false);
  });

  it('combines folders and tags with AND: (a or b) and (t1 or t2)', () => {
    const conditions = criteriaToConditions(
      [
        locationFilterCriteria('/photos/a'),
        tagFilterCriteria('t1'),
        locationFilterCriteria('/photos/b'),
        tagFilterCriteria('t2'),
      ],
      rootStore,
      false,
    );
    expect(conditions).toHaveLength(2);
    expect(matches(conditions, files.aT1)).toBe(true);
    expect(matches(conditions, files.bT2)).toBe(true);
    expect(matches(conditions, files.bT3)).toBe(false); // right folder, wrong tag
    expect(matches(conditions, files.cT1)).toBe(false); // right tag, wrong folder
  });

  it('keeps criteria typed in the search bar as separate AND terms', () => {
    const typed = new ClientStringSearchCriteria('absolutePath', '1.jpg', 'contains');
    const conditions = criteriaToConditions(
      [typed, locationFilterCriteria('/photos/a'), locationFilterCriteria('/photos/b')],
      rootStore,
      false,
    );
    expect(conditions).toHaveLength(2);
    expect(matches(conditions, files.aT1)).toBe(true);
    expect(matches(conditions, files.bT2)).toBe(false);
  });

  it('does not group anything when matching any term', () => {
    const conditions = criteriaToConditions(
      [locationFilterCriteria('/photos/a'), tagFilterCriteria('t1')],
      rootStore,
      true,
    );
    expect(conditions).toHaveLength(2);
    expect(conditions.every((c) => c.valueType !== 'or')).toBe(true);
  });
});
