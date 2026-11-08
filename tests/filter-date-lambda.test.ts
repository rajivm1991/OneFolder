import { filterDateLambda } from '../src/backend/backend';

describe('filterDateLambda', () => {
  const day = new Date(2024, 5, 15, 12, 0, 0);
  const matches = (operator: any, d: Date): boolean =>
    filterDateLambda({ key: 'dateCreated', valueType: 'date', operator, value: day } as any)({
      dateCreated: d,
    });

  const before = new Date(2024, 5, 14, 12, 0, 0);
  const same = new Date(2024, 5, 15, 9, 30, 0);
  const after = new Date(2024, 5, 16, 12, 0, 0);

  it('equals only matches dates within the chosen day', () => {
    expect(matches('equals', same)).toBe(true);
    expect(matches('equals', before)).toBe(false);
    expect(matches('equals', after)).toBe(false);
  });

  describe('dateTaken key', () => {
    const matchesTaken = (file: any): boolean =>
      filterDateLambda({ key: 'dateTaken', valueType: 'date', operator: 'equals', value: day } as any)(file);

    it('equals uses dateTaken when set', () => {
      expect(matchesTaken({ dateTaken: same, dateCreated: before })).toBe(true);
      expect(matchesTaken({ dateTaken: before, dateCreated: same })).toBe(false);
      expect(matchesTaken({ dateTaken: after, dateCreated: same })).toBe(false);
    });

    it('equals falls back to dateCreated when dateTaken is undefined', () => {
      expect(matchesTaken({ dateTaken: undefined, dateCreated: same })).toBe(true);
      expect(matchesTaken({ dateTaken: undefined, dateCreated: before })).toBe(false);
      expect(matchesTaken({ dateTaken: undefined, dateCreated: after })).toBe(false);
    });
  });

  it('notEqual matches dates outside the chosen day', () => {
    expect(matches('notEqual', same)).toBe(false);
    expect(matches('notEqual', before)).toBe(true);
    expect(matches('notEqual', after)).toBe(true);
  });
});
