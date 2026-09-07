import { cellsOf, has, openCells, popcount, type Board } from './board.js';
import { CELLS, colOf, orthoNeighbours, rowOf, shiftCell, type Cell } from './coords.js';
import { placementMask } from './placement.js';
import type { Rng } from './rng.js';
import { FLEET_SPEC, type MaskDirection, type RuleSet, type ShipKind } from './ships.js';

export interface Knowledge {
  readonly shots: Board;
  readonly hits: Board;
  readonly sunkCells: Board;
  readonly remaining: readonly ShipKind[];
  readonly rules: RuleSet;
}

export interface AiPlayer {
  readonly id: 'easy' | 'medium' | 'hard';
  nextShot(knowledge: Knowledge, rng: Rng): Cell;
}

function choose(cells: readonly Cell[], rng: Rng): Cell {
  return cells[rng.int(cells.length)]!;
}

export const easyAi: AiPlayer = {
  id: 'easy',
  nextShot: (knowledge, rng) => choose(openCells(knowledge.shots), rng),
};

export function targetShot(knowledge: Knowledge, rng: Rng): Cell | null {
  const openHits = knowledge.hits & ~knowledge.sunkCells;
  if (openHits === 0n) return null;
  for (const [dr, dc] of [
    [0, 1],
    [1, 0],
  ] as const) {
    for (const cell of cellsOf(openHits)) {
      const previous = shiftCell(cell, -dr, -dc);
      if (previous !== null && has(openHits, previous)) {
        const candidates = [shiftCell(cell, dr, dc), shiftCell(previous, -dr, -dc)].filter(
          (candidate): candidate is Cell => candidate !== null && !has(knowledge.shots, candidate),
        );
        if (candidates.length > 0) return choose(candidates, rng);
      }
    }
  }
  const neighbours = cellsOf(openHits)
    .flatMap(orthoNeighbours)
    .filter((cell, index, cells) => !has(knowledge.shots, cell) && cells.indexOf(cell) === index);
  return neighbours.length > 0 ? choose(neighbours, rng) : null;
}

export const mediumAi: AiPlayer = {
  id: 'medium',
  nextShot(knowledge, rng) {
    const target = targetShot(knowledge, rng);
    if (target !== null) return target;
    const minimum = Math.min(
      ...knowledge.remaining.map((kind) => FLEET_SPEC.find((ship) => ship.kind === kind)!.length),
    );
    const offset = rng.int(minimum);
    const parity = openCells(knowledge.shots).filter(
      (cell) => (rowOf(cell) + colOf(cell)) % minimum === offset,
    );
    return choose(parity.length > 0 ? parity : openCells(knowledge.shots), rng);
  },
};

const HIT_WEIGHT = 12;

export function densityMap(knowledge: Knowledge): Float64Array {
  const density = new Float64Array(CELLS);
  const misses = knowledge.shots & ~knowledge.hits;
  const openHits = knowledge.hits & ~knowledge.sunkCells;
  const blocked = misses | knowledge.sunkCells;
  const targeting = openHits !== 0n;
  for (const kind of knowledge.remaining) {
    const length = FLEET_SPEC.find((ship) => ship.kind === kind)!.length;
    for (const dir of [0, 1] as MaskDirection[]) {
      for (let index = 0; index < CELLS; index += 1) {
        const mask = placementMask(length, index as Cell, dir);
        if (mask === 0n || (mask & blocked) !== 0n) continue;
        const overlap = popcount(mask & openHits);
        if (targeting && overlap === 0) continue;
        const weight = HIT_WEIGHT ** overlap;
        for (const cell of cellsOf(mask & ~knowledge.shots))
          density[cell] = density[cell]! + weight;
      }
    }
  }
  return density;
}

export const hardAi: AiPlayer = {
  id: 'hard',
  nextShot(knowledge, rng) {
    const density = densityMap(knowledge);
    let best = -1;
    let value = -1;
    let ties = 0;
    for (let index = 0; index < CELLS; index += 1) {
      const cell = index as Cell;
      if (has(knowledge.shots, cell)) continue;
      const score = density[index]!;
      if (score > value) {
        best = index;
        value = score;
        ties = 1;
      } else if (score === value && rng.int(++ties) === 0) {
        best = index;
      }
    }
    if (best < 0) throw new Error('AI has no legal shot');
    return best as Cell;
  },
};
