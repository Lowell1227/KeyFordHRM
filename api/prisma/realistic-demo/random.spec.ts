import { SeededRandom } from './random';

describe('SeededRandom', () => {
  it('replays the same seeded sequence', () => {
    const first = new SeededRandom(20260811);
    const second = new SeededRandom(20260811);
    expect(Array.from({ length: 20 }, () => first.int(1, 100))).toEqual(
      Array.from({ length: 20 }, () => second.int(1, 100)),
    );
  });

  it('selects inclusive integer bounds', () => {
    const random = new SeededRandom(20260811);
    expect(Array.from({ length: 20 }, () => random.int(4, 4))).toEqual(
      Array(20).fill(4),
    );
  });

  it('rejects empty selections and non-positive weighted totals', () => {
    const random = new SeededRandom(20260811);
    expect(() => random.pick([])).toThrow('Cannot pick from an empty array');
    expect(() => random.shuffle([])).toThrow('Cannot shuffle an empty array');
    expect(() => random.weighted([])).toThrow('Cannot select from an empty weighted array');
    expect(() => random.weighted([{ value: 'none', weight: 0 }])).toThrow(
      'Total weight must be positive',
    );
  });
});
