# 4. Core Algorithms

All of these live in `packages/engine`, which has **zero runtime dependencies** and is
imported unchanged by the browser, the Web Worker, and the server.

## 4.1 Ship placement validation

Naive validation loops over cells and neighbours per candidate placement. Instead,
precompute every legal placement mask once at module load — there are only
4 lengths × 2 orientations × ≤100 origins ≈ **700 masks** — and reduce validation to two
bitwise operations.

```ts
// packages/engine/src/placement.ts
type Dir = 0 | 1;                     // 0 = horizontal (+col), 1 = vertical (+row)

const SHIP: Board[][][] = [];         // SHIP[len][dir][bow] -> mask, 0n if off-board
const HALO: Board[][][] = [];         // ship cells + 8-neighbourhood, clipped to board

(function buildMasks() {
  for (let len = 0; len <= 5; len++) {
    SHIP[len] = [new Array(CELLS).fill(0n), new Array(CELLS).fill(0n)];
    HALO[len] = [new Array(CELLS).fill(0n), new Array(CELLS).fill(0n)];
  }
  for (const len of [2, 3, 4, 5]) {
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        for (const dir of [0, 1] as Dir[]) {
          const dr = dir === 1 ? 1 : 0;
          const dc = dir === 0 ? 1 : 0;
          if (r + dr * (len - 1) >= SIZE || c + dc * (len - 1) >= SIZE) continue;
          let ship = 0n;
          let halo = 0n;
          for (let i = 0; i < len; i++) {
            const rr = r + dr * i;
            const cc = c + dc * i;
            ship |= bit(toCell(rr, cc));
            for (let er = rr - 1; er <= rr + 1; er++) {
              for (let ec = cc - 1; ec <= cc + 1; ec++) {
                if (er >= 0 && er < SIZE && ec >= 0 && ec < SIZE) halo |= bit(toCell(er, ec));
              }
            }
          }
          SHIP[len][dir][toCell(r, c)] = ship;
          HALO[len][dir][toCell(r, c)] = halo;
        }
      }
    }
  }
})();

export function placementMask(len: number, bow: Cell, dir: Dir): Board {
  return SHIP[len]?.[dir]?.[bow] ?? 0n;      // 0n means "off board"
}

export function isLegalPlacement(
  occupancy: Board, len: number, bow: Cell, dir: Dir, rules: RuleSet,
): boolean {
  const ship = SHIP[len][dir][bow];
  if (ship === 0n) return false;                                  // off-board or bad length
  const blocker = rules.shipsMayTouch ? ship : HALO[len][dir][bow];
  return (blocker & occupancy) === 0n;                            // overlap (+ adjacency)
}
```

Off-board wrap-around — the classic bug where a horizontal ship at `J8` continues onto
the next row — is structurally impossible: masks are generated from `(row, col)` pairs
that were bounds-checked, never by shifting an index by `+1`.

Fleet commit validation is then:

```ts
export function validateFleet(ships: readonly Ship[], rules: RuleSet): Result<Board> {
  if (ships.length !== FLEET_SPEC.length) return err('E_ILLEGAL_PLACEMENT', 'wrong ship count');
  const required = new Set(FLEET_SPEC.map((s) => s.kind));
  let occ = 0n;
  for (const s of ships) {
    if (!required.delete(s.kind)) return err('E_ILLEGAL_PLACEMENT', `duplicate/unknown ${s.kind}`);
    const spec = FLEET_SPEC.find((f) => f.kind === s.kind)!;
    if (s.length !== spec.length) return err('E_ILLEGAL_PLACEMENT', 'length mismatch');
    if (!isLegalPlacement(occ, s.length, s.bow, s.dir === 'V' ? 1 : 0, rules))
      return err('E_ILLEGAL_PLACEMENT', `${s.kind} collides or is off-board`);
    occ |= placementMask(s.length, s.bow, s.dir === 'V' ? 1 : 0);
  }
  if (popcount(occ) !== TOTAL_SHIP_CELLS) return err('E_ILLEGAL_PLACEMENT', 'cell count');
  return ok(occ);
}
```

The final `popcount === 17` check is redundant given the per-ship checks. It stays as a
cheap assertion that catches any future refactor that breaks an earlier invariant.

### Random fleet generation

```ts
export function randomFleet(rng: Rng, rules: RuleSet): Ship[] {
  outer: for (let attempt = 0; attempt < 100; attempt++) {
    let occ = 0n;
    const ships: Ship[] = [];
    for (const { kind, length } of FLEET_SPEC) {          // longest first: fewest options
      const legal: [Cell, Dir][] = [];
      for (const dir of [0, 1] as Dir[])
        for (let bow = 0 as Cell; bow < CELLS; bow++)
          if (isLegalPlacement(occ, length, bow, dir, rules)) legal.push([bow, dir]);
      if (legal.length === 0) continue outer;             // dead end, restart
      const [bow, dir] = legal[rng.int(legal.length)];
      occ |= placementMask(length, bow, dir);
      ships.push({ id: kind, kind, length, bow, dir: dir === 1 ? 'V' : 'H',
                   mask: placementMask(length, bow, dir) });
    }
    return ships;
  }
  throw new Error('unreachable: no legal fleet in 100 attempts');
}
```

Longest-ship-first ordering makes dead ends vanishingly rare (with
`shipsMayTouch: true` the first attempt succeeds essentially always; with the no-touch
variant, restarts occur in single-digit percentages).

> **Honest caveat:** this samples *uniformly at each step*, which is **not** uniform over
> the space of legal fleets — it slightly over-represents configurations reachable by
> greedy ordering. Irrelevant for "randomize my board", but it must not be used as the
> prior in the AI's density estimator. The estimator in §4.3 enumerates placements
> directly instead.

## 4.2 Fog-of-war projection

The rule: **the client never receives a byte it is not entitled to.** Not "the client
receives it but the UI hides it" — that is what makes DevTools-based cheating possible
in most hobby implementations.

```ts
// packages/engine/src/projection.ts
export function projectRoom(state: RoomState, viewer: PlayerId): ProjectedRoomState {
  const me = state.players[viewer];
  const other = opponentOf(state, viewer);
  const revealed = state.phase.kind === 'game_over';

  return {
    code: state.code,
    rules: state.rules,
    phase: projectPhase(state.phase),
    you: {
      id: me.id,
      displayName: me.displayName,
      ships: me.ships.map(toOwnShip),          // full detail: it is their own fleet
      incoming: hex(me.incoming),
      committed: me.committed,
    },
    opponent: other && {
      id: other.id,
      displayName: other.displayName,
      online: other.online,
      committed: other.committed,
      shotsFired: hex(other.incoming),               // shots VIEWER fired at OTHER
      shotsHit: hex(other.incoming & other.fleet),   // ...which of them hit
      sunk: sunkKinds(other),
      // NOTE: `other.fleet` and `other.ships` are never emitted before game over.
    },
    seq: state.seq,
    serverTime: Date.now(),
  };
}
```

Key points:

1. `shotsHit` is `incoming & fleet` — derived data that reveals only what the shooter
   already observed from `shot.result`. It carries no new information; it exists so a
   resuming client can rebuild its board without replaying the whole log.
2. **`sunk` is the one legal leak.** Standard rules require announcing "you sank my
   battleship", which tells the opponent a ship of that length is gone. We announce the
   kind and, on sinking, the sunk ship's cells (the shooter can derive them anyway from
   their own hit history in all but pathological adjacent-ship cases). Setting
   `rules.announceSunkCells = false` yields the stricter "salvo" variant.
3. **Events are projected individually**, not just snapshots. `project(event, state,
   viewer)` returns `null` for events the viewer must not see (e.g. the opponent's
   `fleet.updated`), and the actor filters nulls before sending.
4. Timing side-channels are not defended against, deliberately: a hit and a miss take
   the same code path (two bitwise ops), so there is no measurable difference to exploit.

## 4.3 AI opponent

### Architecture

The AI receives a `Knowledge` object — never `RoomState`. This is enforced by the type
signature, so an AI implementation *cannot* peek even if someone tries:

```ts
// packages/engine/src/ai/types.ts
export interface Knowledge {
  readonly shots: Board;                  // every cell the AI has fired at
  readonly hits: Board;                   // subset of shots that hit
  readonly sunkCells: Board;              // cells of ships known to be sunk
  readonly remaining: readonly ShipKind[];// opponent ships not yet sunk
  readonly rules: RuleSet;
}
export interface AiPlayer {
  readonly id: 'easy' | 'medium' | 'hard';
  nextShot(k: Knowledge, rng: Rng): Cell;
}
```

`misses = shots & ~hits`, `openHits = hits & ~sunkCells` (hits belonging to a ship that
is damaged but not yet sunk).

### Determinism

A seeded PRNG, stored in `RoomState.rngState`, makes every game reproducible from
`(seed, commandLog)` — which is what makes the replay tests in §7.1 possible.

```ts
// packages/engine/src/rng.ts — mulberry32: 32-bit state, good enough, 6 lines
export function makeRng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { next, int: (n: number) => Math.floor(next() * n), state: () => a };
}
```

`Math.random()` appears nowhere in `@bs/engine`. This is enforced by an ESLint
`no-restricted-globals` rule scoped to that package.

### Tier 1 — Easy: uniform random, no repeats

Ignores hits entirely. Exists so new players can win.

```ts
nextShot(k, rng) {
  const open = openCells(k.shots);      // cells not yet fired at
  return open[rng.int(open.length)];
}
```

### Tier 2 — Medium: Hunt & Target with parity

Two modes:

- **Target** (`openHits !== 0n`): fire at cells orthogonally adjacent to an open hit. If
  two or more open hits are collinear, extend along that line first — this is the single
  biggest win over naive adjacency, because it finishes a ship in the minimum number of
  shots instead of probing perpendicular cells.
- **Hunt** (`openHits === 0n`): fire at a random unfired cell satisfying
  `(row + col) % L === offset`, where `L = min(length of remaining ships)`. Any ship of
  length `L` occupies `L` consecutive cells and therefore must cover at least one cell of
  each residue class mod `L`; restricting to one class halves (for `L = 2`) the search
  space with zero risk of missing a ship.

```ts
function targetShot(k: Knowledge, rng: Rng): Cell | null {
  const open = k.hits & ~k.sunkCells;
  if (open === 0n) return null;

  // Prefer extending a known line of >= 2 collinear open hits.
  for (const [dr, dc] of [[0, 1], [1, 0]] as const) {
    for (const c of cellsOf(open)) {
      const prev = shiftCell(c, -dr, -dc);
      if (prev !== null && has(open, prev)) {
        for (const end of [shiftCell(c, dr, dc), shiftCell(prev, -dr, -dc)]) {
          if (end !== null && !has(k.shots, end)) return end;
        }
      }
    }
  }
  // Otherwise probe orthogonal neighbours of any open hit.
  const candidates = cellsOf(open)
    .flatMap((c) => orthoNeighbours(c))
    .filter((c) => !has(k.shots, c));
  return candidates.length ? candidates[rng.int(candidates.length)] : null;
}
```

`shiftCell(c, dr, dc)` returns `null` when it would leave the board — again avoiding
wrap-around by working in `(row, col)` space.

### Tier 3 — Hard: probability density estimation

For every remaining ship, enumerate every placement consistent with observed evidence
and accumulate a density map. The cell with the highest density is the most likely to
contain a ship.

```ts
// packages/engine/src/ai/density.ts
const HIT_WEIGHT = 12;   // tuned by Monte Carlo, see below

export function densityMap(k: Knowledge): Float64Array {
  const density = new Float64Array(CELLS);
  const misses = k.shots & ~k.hits;
  const openHits = k.hits & ~k.sunkCells;
  const blocked = misses | k.sunkCells;   // a remaining ship cannot occupy either
  const targeting = openHits !== 0n;

  for (const kind of k.remaining) {
    const len = FLEET_SPEC.find((s) => s.kind === kind)!.length;
    for (const dir of [0, 1] as Dir[]) {
      for (let bow = 0 as Cell; bow < CELLS; bow++) {
        const mask = SHIP[len][dir][bow];
        if (mask === 0n) continue;
        if ((mask & blocked) !== 0n) continue;              // contradicts evidence

        const overlap = popcount(mask & openHits);
        if (targeting && overlap === 0) continue;           // in target mode, only
                                                            // placements explaining a hit
        const weight = HIT_WEIGHT ** overlap;

        // Credit only cells we have not already fired at.
        for (const c of cellsOf(mask & ~k.shots)) density[c] += weight;
      }
    }
  }
  return density;
}

export const hardAi: AiPlayer = {
  id: 'hard',
  nextShot(k, rng) {
    const d = densityMap(k);
    let best = -1, bestVal = -1, ties = 0;
    for (let c = 0; c < CELLS; c++) {
      if (has(k.shots, c as Cell)) continue;
      if (d[c] > bestVal) { bestVal = d[c]; best = c; ties = 1; }
      else if (d[c] === bestVal && rng.int(++ties) === 0) best = c;   // reservoir tie-break
    }
    return best as Cell;
  },
};
```

Notes on correctness and cost:

- **Cost per move:** ≤ 5 ships × 2 directions × 100 origins = 1 000 candidate masks, each
  a handful of `bigint` operations plus a `popcount`. Sub-millisecond in practice; it
  runs in the Web Worker anyway, so it cannot touch the frame budget. If profiling ever
  shows `bigint` allocation pressure, swap `Board` for `Uint32Array(4)` behind the same
  API — no call site changes.
- **The parity heuristic is unnecessary at this tier.** A density map over placements
  *naturally* produces a parity-like checkerboard bias in hunt mode, because cells on
  the dominant residue class participate in more candidate placements. Bolting explicit
  parity on top measurably makes it slightly *worse* by discarding information.
- **`HIT_WEIGHT` is a tunable, not a constant of nature.** As `HIT_WEIGHT → ∞` the AI
  becomes a strict "finish the wounded ship first" player; at 1 it ignores hits. The
  `targeting` filter already enforces hit-first behaviour, so the weight only shapes the
  choice *among* hit-explaining placements. Tune it with the Monte Carlo harness below;
  do not assume 12 is optimal for our rule set.

### Benchmarking harness (required, not optional)

`packages/engine/bench/ai.bench.ts` plays each tier against 10 000 random legal fleets
and reports the distribution of shots-to-victory:

```
pnpm --filter @bs/engine bench

tier     mean    p50   p90   worst   ms/move
easy     95.9    97    100   100     0.01
medium   ~65     66    78    97      0.03
hard     ~43     43    52    71      0.31
```

The `medium`/`hard` figures above are the widely-reported ballpark for these algorithm
families and are stated here as **expected targets to verify, not measured results**.
The harness is the source of truth; CI fails if `hard` regresses above a mean of 48.

### Difficulty presentation

Three honest tiers, plus an explicit `mistakeRate` on Hard used for a "Casual" preset
(the AI computes the optimal shot, then with probability `p` fires a random open cell
instead). Degrading a strong AI with a stated error rate is more controllable — and more
honest to the player — than pretending a weak algorithm is a difficulty setting.

### Where the AI runs

In single-player, the AI runs **client-side in a Web Worker**, alongside a local
`RoomActor`. Consequences worth stating plainly:

- Zero server cost, zero latency, works offline.
- A determined player can open DevTools and inspect the AI's board. This is
  unpreventable in a client-only game and **not worth preventing** — the only person
  cheated is the cheater. Do not spend engineering effort obfuscating it. Ranked and
  multiplayer modes are server-authoritative, which is where the guarantee matters.
- An artificial "thinking" delay of 400–900 ms (jittered) is applied before the AI's
  shot, because an instantaneous response reads as broken rather than fast.
