import fc from 'fast-check';
import { expect, test } from 'vitest';
import {
  CELLS,
  FLEET_SPEC,
  STANDARD_RULES,
  bit,
  hardAi,
  has,
  makeRng,
  type Knowledge,
} from '../src/index.js';

const emptyKnowledge = (): Knowledge => ({
  shots: 0n,
  hits: 0n,
  sunkCells: 0n,
  remaining: FLEET_SPEC.map(({ kind }) => kind),
  rules: STANDARD_RULES,
});

test.each(Array.from({ length: 5 }, (_, index) => index + 5))(
  'hard never repeats a shot (batch %i)',
  (batch) => {
    fc.assert(
      fc.property(fc.integer(), (seed) => {
        const rng = makeRng(seed ^ batch);
        let knowledge = emptyKnowledge();
        for (let count = 0; count < CELLS; count += 1) {
          const cell = hardAi.nextShot(knowledge, rng);
          expect(has(knowledge.shots, cell)).toBe(false);
          knowledge = { ...knowledge, shots: knowledge.shots | bit(cell) };
        }
      }),
      { numRuns: 50 },
    );
  },
  15_000,
);
