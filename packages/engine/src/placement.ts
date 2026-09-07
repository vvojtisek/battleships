import { EMPTY, bit, popcount, type Board } from './board.js';
import { CELLS, SIZE, toCell, type Cell } from './coords.js';
import { err, ok, type Result } from './result.js';
import {
  FLEET_SPEC,
  TOTAL_SHIP_CELLS,
  type Direction,
  type MaskDirection,
  type RuleSet,
  type Ship,
  type ShipKind,
} from './ships.js';
import type { Rng } from './rng.js';

const SHIP: Board[][][] = [];
const HALO: Board[][][] = [];

for (let length = 0; length <= 5; length += 1) {
  SHIP[length] = [new Array<Board>(CELLS).fill(EMPTY), new Array<Board>(CELLS).fill(EMPTY)];
  HALO[length] = [new Array<Board>(CELLS).fill(EMPTY), new Array<Board>(CELLS).fill(EMPTY)];
}

for (const length of [2, 3, 4, 5]) {
  for (let row = 0; row < SIZE; row += 1) {
    for (let col = 0; col < SIZE; col += 1) {
      for (const dir of [0, 1] as const) {
        const dr = dir;
        const dc = dir === 0 ? 1 : 0;
        if (row + dr * (length - 1) >= SIZE || col + dc * (length - 1) >= SIZE) continue;
        let mask = EMPTY;
        let halo = EMPTY;
        for (let offset = 0; offset < length; offset += 1) {
          const shipRow = row + dr * offset;
          const shipCol = col + dc * offset;
          mask |= bit(toCell(shipRow, shipCol));
          for (let nearRow = shipRow - 1; nearRow <= shipRow + 1; nearRow += 1) {
            for (let nearCol = shipCol - 1; nearCol <= shipCol + 1; nearCol += 1) {
              if (nearRow >= 0 && nearRow < SIZE && nearCol >= 0 && nearCol < SIZE) {
                halo |= bit(toCell(nearRow, nearCol));
              }
            }
          }
        }
        SHIP[length]?.[dir]!.splice(toCell(row, col), 1, mask);
        HALO[length]?.[dir]!.splice(toCell(row, col), 1, halo);
      }
    }
  }
}

export function placementMask(length: number, bow: Cell, dir: MaskDirection): Board {
  return SHIP[length]?.[dir]![bow] ?? EMPTY;
}

export function isLegalPlacement(
  occupancy: Board,
  length: number,
  bow: Cell,
  dir: MaskDirection,
  rules: RuleSet,
): boolean {
  const mask = placementMask(length, bow, dir);
  if (mask === EMPTY) return false;
  const blocker = rules.shipsMayTouch ? mask : HALO[length]![dir]![bow]!;
  return (blocker & occupancy) === EMPTY;
}

export function makeShip(kind: ShipKind, bow: Cell, dir: Direction): Ship {
  const spec = FLEET_SPEC.find((candidate) => candidate.kind === kind);
  if (!spec) throw new Error(`unknown ship kind: ${kind}`);
  const maskDir = dir === 'V' ? 1 : 0;
  return {
    id: kind,
    kind,
    length: spec.length,
    bow,
    dir,
    mask: placementMask(spec.length, bow, maskDir),
  };
}

export function validateFleet(
  ships: readonly Ship[],
  rules: RuleSet,
): Result<Board, 'E_ILLEGAL_PLACEMENT'> {
  if (ships.length !== FLEET_SPEC.length) return err('E_ILLEGAL_PLACEMENT', 'wrong ship count');
  const required = new Set<ShipKind>(FLEET_SPEC.map(({ kind }) => kind));
  let occupancy = EMPTY;
  for (const ship of ships) {
    const spec = FLEET_SPEC.find(({ kind }) => kind === ship.kind);
    if (!spec || !required.delete(ship.kind))
      return err('E_ILLEGAL_PLACEMENT', `duplicate or unknown ship: ${ship.kind}`);
    if (ship.id !== ship.kind || ship.length !== spec.length)
      return err('E_ILLEGAL_PLACEMENT', 'ship metadata mismatch');
    const dir = ship.dir === 'V' ? 1 : 0;
    const expected = placementMask(ship.length, ship.bow, dir);
    if (expected !== ship.mask || !isLegalPlacement(occupancy, ship.length, ship.bow, dir, rules)) {
      return err('E_ILLEGAL_PLACEMENT', `${ship.kind} collides or is off-board`);
    }
    occupancy |= expected;
  }
  /* v8 ignore next 2 */
  if (popcount(occupancy) !== TOTAL_SHIP_CELLS)
    return err('E_ILLEGAL_PLACEMENT', 'wrong occupied cell count');
  return ok(occupancy);
}

export function isLegalFleetDraft(ships: readonly Ship[], rules: RuleSet): boolean {
  const kinds = new Set<ShipKind>();
  let occupancy = EMPTY;
  for (const ship of ships) {
    const spec = FLEET_SPEC.find(({ kind }) => kind === ship.kind);
    if (!spec || kinds.has(ship.kind) || ship.id !== ship.kind || ship.length !== spec.length)
      return false;
    const dir = ship.dir === 'V' ? 1 : 0;
    if (
      ship.mask !== placementMask(ship.length, ship.bow, dir) ||
      !isLegalPlacement(occupancy, ship.length, ship.bow, dir, rules)
    )
      return false;
    kinds.add(ship.kind);
    occupancy |= ship.mask;
  }
  return true;
}

export function randomFleet(rng: Rng, rules: RuleSet): Ship[] {
  return randomFleetAttempt(rng, rules, 0);
}

function randomFleetAttempt(rng: Rng, rules: RuleSet, attempt: number): Ship[] {
  /* v8 ignore next */
  if (attempt === 100) throw new Error('unable to generate a legal fleet in 100 attempts');
  let occupancy = EMPTY;
  const ships: Ship[] = [];
  for (const { kind, length } of FLEET_SPEC) {
    const legal: [Cell, MaskDirection][] = [];
    for (const dir of [0, 1] as const) {
      for (let value = 0; value < CELLS; value += 1) {
        const bow = value as Cell;
        if (isLegalPlacement(occupancy, length, bow, dir, rules)) legal.push([bow, dir]);
      }
    }
    /* v8 ignore next */
    if (legal.length === 0) return randomFleetAttempt(rng, rules, attempt + 1);
    const selected = legal[rng.int(legal.length)];
    /* v8 ignore next */
    if (!selected) throw new Error('RNG selected outside legal placements');
    const [bow, dir] = selected;
    const ship = makeShip(kind, bow, dir === 0 ? 'H' : 'V');
    occupancy |= ship.mask;
    ships.push(ship);
  }
  return ships;
}
