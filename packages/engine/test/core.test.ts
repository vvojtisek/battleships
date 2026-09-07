import { describe, expect, test } from 'vitest';
import {
  CELLS,
  EMPTY,
  FULL,
  allCells,
  bit,
  cellsOf,
  colOf,
  fromHex,
  has,
  hex,
  isCell,
  label,
  makeRng,
  openCells,
  orthoNeighbours,
  parseCell,
  popcount,
  rowOf,
  shiftCell,
  toCell,
} from '../src/index.js';

describe('coordinates and boards', () => {
  test('converts, labels, parses, and validates coordinates', () => {
    expect(toCell(0, 0)).toBe(0);
    expect(toCell(9, 9)).toBe(99);
    expect(() => toCell(-1, 0)).toThrow(RangeError);
    expect(() => toCell(0.5, 0)).toThrow(RangeError);
    expect(isCell(0)).toBe(true);
    expect(isCell(99)).toBe(true);
    expect(isCell(100)).toBe(false);
    expect(isCell(1.5)).toBe(false);
    expect(rowOf(toCell(4, 7))).toBe(4);
    expect(colOf(toCell(4, 7))).toBe(7);
    expect(label(toCell(9, 9))).toBe('J10');
    expect(parseCell(' a1 ')).toBe(0);
    expect(parseCell('J10')).toBe(99);
    expect(parseCell('K1')).toBeNull();
    expect(allCells()).toHaveLength(CELLS);
  });

  test('shifts without wrapping and finds orthogonal neighbours', () => {
    expect(shiftCell(toCell(0, 0), -1, 0)).toBeNull();
    expect(shiftCell(toCell(0, 0), 0, -1)).toBeNull();
    expect(shiftCell(toCell(9, 9), 1, 0)).toBeNull();
    expect(shiftCell(toCell(9, 9), 0, 1)).toBeNull();
    expect(shiftCell(toCell(5, 5), 1, -1)).toBe(toCell(6, 4));
    expect(orthoNeighbours(toCell(0, 0))).toEqual([toCell(1, 0), toCell(0, 1)]);
  });

  test('performs bitboard operations and safe hexadecimal conversion', () => {
    const board = bit(toCell(0, 0)) | bit(toCell(9, 9));
    expect(has(board, toCell(0, 0))).toBe(true);
    expect(has(board, toCell(0, 1))).toBe(false);
    expect(popcount(board)).toBe(2);
    expect(popcount(FULL | (1n << 101n))).toBe(100);
    expect(cellsOf(board)).toEqual([toCell(0, 0), toCell(9, 9)]);
    expect(openCells(FULL)).toEqual([]);
    expect(fromHex(hex(board))).toBe(board);
    expect(fromHex('')).toBeNull();
    expect(fromHex('g')).toBeNull();
    expect(fromHex('f'.repeat(26))).toBeNull();
    expect(fromHex('f'.repeat(25))).toBe(FULL);
    expect(EMPTY).toBe(0n);
  });
});

describe('seeded random number generator', () => {
  test('is deterministic, exposes state, and rejects invalid bounds', () => {
    const first = makeRng(-1);
    const second = makeRng(0xffff_ffff);
    expect(first.next()).toBe(second.next());
    expect(first.int(10)).toBe(second.int(10));
    expect(first.state()).toBe(second.state());
    expect(() => first.int(0)).toThrow(RangeError);
    expect(() => first.int(1.5)).toThrow(RangeError);
  });
});
