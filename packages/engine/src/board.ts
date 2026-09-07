import { allCells, type Cell } from './coords.js';

export type Board = bigint;
export const EMPTY: Board = 0n;
export const FULL: Board = (1n << 100n) - 1n;

export const bit = (cell: Cell): Board => 1n << BigInt(cell);
export const has = (board: Board, cell: Cell): boolean => (board & bit(cell)) !== 0n;

export function popcount(value: Board): number {
  let board = value & FULL;
  let count = 0;
  while (board !== 0n) {
    board &= board - 1n;
    count += 1;
  }
  return count;
}

export function cellsOf(board: Board): Cell[] {
  return allCells().filter((cell) => has(board, cell));
}

export function openCells(board: Board): Cell[] {
  return cellsOf(FULL & ~board);
}

export const hex = (board: Board): string => board.toString(16);

export function fromHex(value: string): Board | null {
  if (!/^[0-9a-f]{1,25}$/i.test(value)) return null;
  return BigInt(`0x${value}`);
}
