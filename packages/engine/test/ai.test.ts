import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import {
  CELLS,
  FLEET_SPEC,
  STANDARD_RULES,
  bit,
  densityMap,
  easyAi,
  hardAi,
  has,
  makeRng,
  mediumAi,
  targetShot,
  toCell,
  type Knowledge,
} from '../src/index.js';

const emptyKnowledge = (): Knowledge => ({
  shots: 0n,
  hits: 0n,
  sunkCells: 0n,
  remaining: FLEET_SPEC.map(({ kind }) => kind),
  rules: STANDARD_RULES,
});

describe('AI players', () => {
  test.each([easyAi, mediumAi])('$id never repeats a shot', (ai) => {
    fc.assert(
      fc.property(fc.integer(), (seed) => {
        const rng = makeRng(seed);
        let knowledge = emptyKnowledge();
        for (let count = 0; count < CELLS; count += 1) {
          const cell = ai.nextShot(knowledge, rng);
          expect(has(knowledge.shots, cell)).toBe(false);
          knowledge = { ...knowledge, shots: knowledge.shots | bit(cell) };
        }
      }),
      { numRuns: 500 },
    );
  });

  test.each(Array.from({ length: 5 }, (_, batch) => batch))(
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

  test('targets adjacent hits and extends collinear hits', () => {
    const rng = makeRng(1);
    const oneHit: Knowledge = {
      ...emptyKnowledge(),
      shots: bit(toCell(5, 5)),
      hits: bit(toCell(5, 5)),
    };
    expect([toCell(4, 5), toCell(6, 5), toCell(5, 4), toCell(5, 6)]).toContain(
      targetShot(oneHit, rng),
    );
    const line = bit(toCell(5, 5)) | bit(toCell(5, 6));
    const shot = targetShot({ ...emptyKnowledge(), shots: line, hits: line }, rng);
    expect([toCell(5, 4), toCell(5, 7)]).toContain(shot);
    expect(targetShot(emptyKnowledge(), rng)).toBeNull();
    const trapped: Knowledge = {
      ...emptyKnowledge(),
      shots: bit(toCell(0, 0)) | bit(toCell(0, 1)) | bit(toCell(1, 0)),
      hits: bit(toCell(0, 0)),
    };
    expect(targetShot(trapped, rng)).toBeNull();
    expect(mediumAi.nextShot(oneHit, rng)).not.toBe(toCell(5, 5));
  });

  test('density assigns zero to misses and hard targets evidence', () => {
    const miss = toCell(4, 4);
    const hit = toCell(2, 2);
    const knowledge: Knowledge = {
      ...emptyKnowledge(),
      shots: bit(miss) | bit(hit),
      hits: bit(hit),
    };
    const density = densityMap(knowledge);
    expect(density[miss]).toBe(0);
    expect(hardAi.nextShot(knowledge, makeRng(2))).not.toBe(miss);
  });

  test('reports exhaustion instead of repeating', () => {
    const full = { ...emptyKnowledge(), shots: (1n << 100n) - 1n };
    expect(() => easyAi.nextShot(full, makeRng(1))).toThrow('maxExclusive');
    expect(() => hardAi.nextShot(full, makeRng(1))).toThrow('no legal shot');
  });
});
