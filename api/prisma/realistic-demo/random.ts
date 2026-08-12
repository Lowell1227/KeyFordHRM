export interface WeightedItem<T> {
  value: T;
  weight: number;
}

export class SeededRandom {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  next(): number {
    let value = this.state;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this.state = value >>> 0;
    return this.state / 0x100000000;
  }

  int(min: number, max: number): number {
    if (!Number.isInteger(min) || !Number.isInteger(max) || min > max) {
      throw new Error('Integer bounds must be ordered integers');
    }
    return min + Math.floor(this.next() * (max - min + 1));
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) {
      throw new Error('Cannot pick from an empty array');
    }
    return items[this.int(0, items.length - 1)];
  }

  shuffle<T>(items: readonly T[]): T[] {
    if (items.length === 0) {
      throw new Error('Cannot shuffle an empty array');
    }
    const shuffled = [...items];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const target = this.int(0, index);
      [shuffled[index], shuffled[target]] = [shuffled[target], shuffled[index]];
    }
    return shuffled;
  }

  weighted<T>(items: readonly WeightedItem<T>[]): T {
    if (items.length === 0) {
      throw new Error('Cannot select from an empty weighted array');
    }

    const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
    if (!Number.isFinite(totalWeight) || totalWeight <= 0) {
      throw new Error('Total weight must be positive');
    }

    let threshold = this.next() * totalWeight;
    for (const item of items) {
      threshold -= item.weight;
      if (threshold < 0) {
        return item.value;
      }
    }
    return items[items.length - 1].value;
  }
}
