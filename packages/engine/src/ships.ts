import type { Board } from './board.js';
import type { Cell } from './coords.js';

export type ShipKind = 'carrier' | 'battleship' | 'cruiser' | 'submarine' | 'destroyer';
export type Direction = 'H' | 'V';
export type MaskDirection = 0 | 1;

export const FLEET_SPEC = [
  { kind: 'carrier', length: 5 },
  { kind: 'battleship', length: 4 },
  { kind: 'cruiser', length: 3 },
  { kind: 'submarine', length: 3 },
  { kind: 'destroyer', length: 2 },
] as const satisfies readonly { kind: ShipKind; length: number }[];

export const TOTAL_SHIP_CELLS = 17;
export const MIN_SHIP_LENGTH = 2;

export interface Ship {
  readonly id: ShipKind;
  readonly kind: ShipKind;
  readonly length: number;
  readonly bow: Cell;
  readonly dir: Direction;
  readonly mask: Board;
}

export interface RuleSet {
  readonly shipsMayTouch: boolean;
  readonly extraTurnOnHit: boolean;
  readonly turnSeconds: number;
  readonly placementSeconds: number;
  readonly disconnectGraceSeconds: number;
}

export const STANDARD_RULES: RuleSet = {
  shipsMayTouch: false,
  extraTurnOnHit: false,
  turnSeconds: 45,
  placementSeconds: 180,
  disconnectGraceSeconds: 120,
};

export function shipLength(kind: ShipKind): number {
  const spec = FLEET_SPEC.find((candidate) => candidate.kind === kind);
  if (!spec) throw new Error(`unknown ship kind: ${kind}`);
  return spec.length;
}
