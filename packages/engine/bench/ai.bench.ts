import { performance } from 'node:perf_hooks';
import {
  FLEET_SPEC,
  STANDARD_RULES,
  bit,
  easyAi,
  hardAi,
  makeRng,
  mediumAi,
  randomFleet,
  type AiPlayer,
  type Board,
  type Knowledge,
  type Ship,
  type ShipKind,
} from '../src/index.js';

const RUNS = 10_000;

function attack(ai: AiPlayer, seed: number): number {
  const fleetRng = makeRng(seed);
  const fleet = randomFleet(fleetRng, STANDARD_RULES);
  const fleetMask = fleet.reduce((mask, ship) => mask | ship.mask, 0n);
  const shotRng = makeRng(seed ^ 0x9e37_79b9);
  let shots: Board = 0n;
  let hits: Board = 0n;
  let sunkCells: Board = 0n;
  let remaining = FLEET_SPEC.map(({ kind }) => kind) as ShipKind[];
  for (let count = 1; count <= 100; count += 1) {
    const knowledge: Knowledge = { shots, hits, sunkCells, remaining, rules: STANDARD_RULES };
    const cell = ai.nextShot(knowledge, shotRng);
    shots |= bit(cell);
    if ((fleetMask & bit(cell)) !== 0n) hits |= bit(cell);
    const newlySunk = fleet.filter(
      (ship: Ship) => remaining.includes(ship.kind) && (ship.mask & hits) === ship.mask,
    );
    for (const ship of newlySunk) {
      sunkCells |= ship.mask;
      remaining = remaining.filter((kind) => kind !== ship.kind);
    }
    if (hits === fleetMask) return count;
  }
  throw new Error('AI did not finish within 100 shots');
}

for (const ai of [easyAi, mediumAi, hardAi]) {
  const started = performance.now();
  const scores = Array.from({ length: RUNS }, (_, seed) => attack(ai, seed)).sort((a, b) => a - b);
  const elapsed = performance.now() - started;
  const mean = scores.reduce((total, score) => total + score, 0) / RUNS;
  const percentile = (fraction: number): number => scores[Math.floor((RUNS - 1) * fraction)] ?? 0;
  process.stdout.write(
    `${ai.id.padEnd(6)} mean=${mean.toFixed(2)} p50=${percentile(0.5)} p90=${percentile(0.9)} worst=${scores.at(-1)} ms/move=${(elapsed / scores.reduce((a, b) => a + b, 0)).toFixed(3)}\n`,
  );
  if (ai.id === 'hard' && mean > 48) process.exitCode = 1;
}
