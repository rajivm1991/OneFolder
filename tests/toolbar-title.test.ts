jest.mock('../src/frontend/entities/Location', () => ({}));

import SysPath from 'path';

import {
  ClientDateSearchCriteria,
  ClientStringSearchCriteria,
} from '../src/frontend/entities/SearchCriteria';
import {
  locationFilterCriteria,
  tagFilterCriteria,
} from '../src/frontend/containers/Outliner/filter-utils';
import {
  itemCountLabel,
  summarizeFilters,
  toolbarTitle,
} from '../src/frontend/containers/AppToolbar/toolbar-title';

const tagNames: Record<string, string> = { t1: 'Travel', t2: 'Family' };
const tagName = (id: string) => tagNames[id];
const none = { names: [], otherCount: 0 };

describe('summarizeFilters', () => {
  it('names tags, Untagged and folders, and counts the rest', () => {
    const summary = summarizeFilters(
      [
        tagFilterCriteria('t1'),
        tagFilterCriteria(),
        locationFilterCriteria(SysPath.join('photos', 'Camera Roll')),
        new ClientStringSearchCriteria('name', 'beach'),
        new ClientDateSearchCriteria('dateCreated', new Date(2024, 0, 1), 'greaterThanOrEquals'),
      ],
      tagName,
    );
    expect(summary).toEqual({ names: ['Travel', 'Untagged', 'Camera Roll'], otherCount: 2 });
  });

  it('does not treat a tag typed in the search bar as a sidebar filter', () => {
    const typed = new ClientStringSearchCriteria('absolutePath', 'x');
    expect(summarizeFilters([typed], tagName)).toEqual({ names: [], otherCount: 1 });
  });

  it('shows a tag that no longer exists as Tag', () => {
    expect(summarizeFilters([tagFilterCriteria('gone')], tagName).names).toEqual(['Tag']);
  });
});

describe('toolbarTitle', () => {
  it('says All images without filters', () => {
    expect(toolbarTitle('files', false, none)).toBe('All images');
  });

  it('uses the name of a single filter', () => {
    expect(toolbarTitle('files', false, { names: ['Travel'], otherCount: 0 })).toBe('Travel');
  });

  it('says Filtered images for several filters or any other term', () => {
    expect(toolbarTitle('files', false, { names: ['Travel', 'Family'], otherCount: 0 })).toBe(
      'Filtered images',
    );
    expect(toolbarTitle('files', false, { names: ['Travel'], otherCount: 1 })).toBe(
      'Filtered images',
    );
    expect(toolbarTitle('files', false, { names: [], otherCount: 2 })).toBe('Filtered images');
  });

  it('names the other views and the missing files', () => {
    expect(toolbarTitle('map', false, none)).toBe('Map');
    expect(toolbarTitle('people', false, none)).toBe('People');
    expect(toolbarTitle('duplicates', false, none)).toBe('Duplicates');
    expect(toolbarTitle('files', true, none)).toBe('Missing files');
  });
});

describe('itemCountLabel', () => {
  it('pluralises and groups digits', () => {
    expect(itemCountLabel(1)).toBe('1 item');
    expect(itemCountLabel(0)).toBe('0 items');
    expect(itemCountLabel(12408)).toBe(`${(12408).toLocaleString()} items`);
  });
});
