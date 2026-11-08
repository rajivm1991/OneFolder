import { countByMonth } from '../src/backend/backend';

describe('countByMonth', () => {
  it('returns nothing for no dates', () => {
    expect(countByMonth([])).toEqual([]);
  });

  it('counts files per local year and month, newest month first', () => {
    const dates = [
      new Date(2023, 0, 5),
      new Date(2024, 2, 1),
      new Date(2024, 2, 31, 23, 59),
      new Date(2023, 11, 31),
      new Date(2024, 0, 1),
    ];
    expect(countByMonth(dates)).toEqual([
      { year: 2024, month: 2, count: 2 },
      { year: 2024, month: 0, count: 1 },
      { year: 2023, month: 11, count: 1 },
      { year: 2023, month: 0, count: 1 },
    ]);
  });

  it('keeps the same month of different years apart', () => {
    const result = countByMonth([new Date(2022, 5, 1), new Date(2023, 5, 1)]);
    expect(result).toEqual([
      { year: 2023, month: 5, count: 1 },
      { year: 2022, month: 5, count: 1 },
    ]);
  });

  it('skips invalid dates', () => {
    expect(countByMonth([new Date('not a date'), new Date(2024, 4, 2)])).toEqual([
      { year: 2024, month: 4, count: 1 },
    ]);
  });
});
