import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import {
  FLEET_SPEC,
  STANDARD_RULES,
  TOTAL_SHIP_CELLS,
  allCells,
  cellsOf,
  colOf,
  isLegalPlacement,
  isLegalFleetDraft,
  makeRng,
  makeShip,
  placementMask,
  popcount,
  randomFleet,
  rowOf,
  shipLength,
  toCell,
  validateFleet,
  type RuleSet,
  type Ship,
} from '../src/index.js';

const TOUCHING_ALLOWED: RuleSet = { ...STANDARD_RULES, shipsMayTouch: true };

describe('placement', () => {
  test('precomputed masks never wrap and always have the requested length', () => {
    for (const length of [2, 3, 4, 5]) {
      for (const bow of allCells()) {
        for (const dir of [0, 1] as const) {
          const mask = placementMask(length, bow, dir);
          if (mask === 0n) continue;
          const cells = cellsOf(mask);
          expect(cells).toHaveLength(length);
          expect(
            dir === 0
              ? cells.every((cell) => rowOf(cell) === rowOf(bow))
              : cells.every((cell) => colOf(cell) === colOf(bow)),
          ).toBe(true);
        }
      }
    }
    expect(placementMask(1, toCell(0, 0), 0)).toBe(0n);
    expect(placementMask(2, 100 as never, 0)).toBe(0n);
  });

  test('enforces overlap and no-touch halos by default', () => {
    const first = makeShip('destroyer', toCell(0, 0), 'H');
    expect(isLegalPlacement(first.mask, 3, toCell(0, 1), 1, STANDARD_RULES)).toBe(false);
    expect(isLegalPlacement(first.mask, 3, toCell(1, 0), 0, STANDARD_RULES)).toBe(false);
    expect(isLegalPlacement(first.mask, 3, toCell(1, 2), 0, STANDARD_RULES)).toBe(false);
    expect(isLegalPlacement(first.mask, 3, toCell(1, 0), 0, TOUCHING_ALLOWED)).toBe(true);
    expect(isLegalPlacement(0n, 5, toCell(9, 9), 0, STANDARD_RULES)).toBe(false);
  });

  test('validates ship identity, count, length, masks, and collisions', () => {
    const fleet = randomFleet(makeRng(7), STANDARD_RULES);
    expect(validateFleet(fleet, STANDARD_RULES)).toEqual({
      ok: true,
      value: fleet.reduce((mask, ship) => mask | ship.mask, 0n),
    });
    expect(validateFleet(fleet.slice(1), STANDARD_RULES)).toMatchObject({
      ok: false,
      detail: 'wrong ship count',
    });
    expect(validateFleet([...fleet.slice(0, 4), fleet[0] as Ship], STANDARD_RULES)).toMatchObject({
      ok: false,
    });
    const badLength = { ...(fleet[0] as Ship), length: 4 };
    expect(validateFleet([badLength, ...fleet.slice(1)], STANDARD_RULES)).toMatchObject({
      ok: false,
      detail: 'ship metadata mismatch',
    });
    const badMask = { ...(fleet[0] as Ship), mask: 0n };
    expect(validateFleet([badMask, ...fleet.slice(1)], STANDARD_RULES)).toMatchObject({
      ok: false,
    });
    expect(isLegalFleetDraft([badMask], STANDARD_RULES)).toBe(false);
    expect(isLegalFleetDraft([fleet[0]!, fleet[0]!], STANDARD_RULES)).toBe(false);
    expect(shipLength('carrier')).toBe(5);
    expect(() => shipLength('nope' as never)).toThrow('unknown ship kind');
    expect(() => makeShip('nope' as never, toCell(0, 0), 'H')).toThrow('unknown ship kind');
  });

  test('generates legal fleets for both standard variants across 10,000 seeds', () => {
    fc.assert(
      fc.property(fc.integer(), fc.boolean(), (seed, shipsMayTouch) => {
        const rules = { ...STANDARD_RULES, shipsMayTouch };
        const fleet = randomFleet(makeRng(seed), rules);
        const result = validateFleet(fleet, rules);
        expect(result.ok).toBe(true);
        if (result.ok) expect(popcount(result.value)).toBe(TOTAL_SHIP_CELLS);
        expect(fleet.map(({ kind }) => kind)).toEqual(FLEET_SPEC.map(({ kind }) => kind));
      }),
      { numRuns: 10_000 },
    );
  });
});
