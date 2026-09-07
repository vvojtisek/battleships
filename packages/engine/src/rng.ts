export interface Rng {
  next(): number;
  int(maxExclusive: number): number;
  state(): number;
}

export function makeRng(seed: number): Rng {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
  return {
    next,
    int(maxExclusive) {
      if (!Number.isInteger(maxExclusive) || maxExclusive <= 0)
        throw new RangeError('maxExclusive must be positive');
      return Math.floor(next() * maxExclusive);
    },
    state: () => state,
  };
}
