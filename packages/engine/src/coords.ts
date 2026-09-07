export const SIZE = 10;
export const CELLS = SIZE * SIZE;

declare const cellBrand: unique symbol;
export type Cell = number & { readonly [cellBrand]: true };

export function isCell(value: number): value is Cell {
  return Number.isInteger(value) && value >= 0 && value < CELLS;
}

export function toCell(row: number, col: number): Cell {
  if (
    !Number.isInteger(row) ||
    !Number.isInteger(col) ||
    row < 0 ||
    row >= SIZE ||
    col < 0 ||
    col >= SIZE
  ) {
    throw new RangeError(`invalid coordinates: ${row},${col}`);
  }
  return (row * SIZE + col) as Cell;
}

export const rowOf = (cell: Cell): number => Math.floor(cell / SIZE);
export const colOf = (cell: Cell): number => cell % SIZE;
export const label = (cell: Cell): string =>
  `${String.fromCharCode(65 + colOf(cell))}${rowOf(cell) + 1}`;

export function parseCell(value: string): Cell | null {
  const match = /^([A-J])(10|[1-9])$/i.exec(value.trim());
  if (!match) return null;
  const column = match[1];
  const row = match[2];
  /* v8 ignore next */
  if (column === undefined || row === undefined) return null;
  return toCell(Number(row) - 1, column.toUpperCase().charCodeAt(0) - 65);
}

export function allCells(): Cell[] {
  return Array.from({ length: CELLS }, (_, index) => index as Cell);
}

export function shiftCell(cell: Cell, rowDelta: number, colDelta: number): Cell | null {
  const row = rowOf(cell) + rowDelta;
  const col = colOf(cell) + colDelta;
  return row >= 0 && row < SIZE && col >= 0 && col < SIZE ? toCell(row, col) : null;
}

export function orthoNeighbours(cell: Cell): Cell[] {
  return [
    shiftCell(cell, -1, 0),
    shiftCell(cell, 1, 0),
    shiftCell(cell, 0, -1),
    shiftCell(cell, 0, 1),
  ].filter((candidate): candidate is Cell => candidate !== null);
}
