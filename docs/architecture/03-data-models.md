# 3. Data Models & Schemas

## 3.1 Coordinates and the board representation

Cells are a flat index, `cell = row * 10 + col`, `0 ≤ cell ≤ 99`. Display coordinates
are columns `A–J` and rows `1–10` (`A1` = cell 0). Conversion lives in one place:

```ts
// packages/engine/src/coords.ts
export const SIZE = 10;
export const CELLS = SIZE * SIZE;              // 100
export type Cell = number & { readonly __brand: 'Cell' };

export const toCell = (row: number, col: number): Cell => (row * SIZE + col) as Cell;
export const rowOf = (c: Cell) => Math.floor(c / SIZE);
export const colOf = (c: Cell) => c % SIZE;
export const label = (c: Cell) => `${String.fromCharCode(65 + colOf(c))}${rowOf(c) + 1}`;
```

**Boards are 100-bit bitboards held in `bigint`.** A 10×10 board does not fit in a
`number` (53 safe bits) but fits comfortably in a `bigint`, and every board question
becomes one machine-word-ish operation instead of a loop over cells:

```ts
export type Board = bigint;                    // bit i set <=> cell i
export const bit = (c: Cell): Board => 1n << BigInt(c);
export const has = (b: Board, c: Cell) => (b & bit(c)) !== 0n;
export const FULL: Board = (1n << 100n) - 1n;

export function popcount(b: Board): number {    // used for "hits remaining"
  let n = 0;
  while (b) { b &= b - 1n; n++; }
  return n;
}
```

Three masks per player fully describe a game:

| Mask | Meaning |
|---|---|
| `fleet` | Cells occupied by that player's ships (17 bits set once committed) |
| `incoming` | Cells the **opponent** has fired at this player |
| `hits` | `fleet & incoming` — derived, cached for speed |

`hits === fleet` ⇔ that player has lost. Win detection is one comparison.

> **Serialization caveat.** `bigint` is not JSON-serializable. `@bs/protocol` converts
> at the boundary with `board.toString(16)` / `BigInt('0x' + hex)`; a `zod` transform
> enforces `/^[0-9a-f]{1,25}$/` and `value <= FULL`. Never `JSON.stringify` a state
> object containing a raw `bigint` — it throws, and the resulting 500 would be a
> denial-of-service vector if reachable from user input.

## 3.2 Ships and rules

```ts
export type ShipKind = 'carrier' | 'battleship' | 'cruiser' | 'submarine' | 'destroyer';

export const FLEET_SPEC = [
  { kind: 'carrier',    length: 5 },
  { kind: 'battleship', length: 4 },
  { kind: 'cruiser',    length: 3 },
  { kind: 'submarine',  length: 3 },
  { kind: 'destroyer',  length: 2 },
] as const satisfies readonly { kind: ShipKind; length: number }[];

export const TOTAL_SHIP_CELLS = 17;
export const MIN_SHIP_LENGTH = 2;   // drives AI parity, see §4.3

export interface Ship {
  readonly id: string;          // stable per game: `${kind}` (unique in a standard fleet)
  readonly kind: ShipKind;
  readonly length: number;
  readonly bow: Cell;           // topmost cell if vertical, leftmost if horizontal
  readonly dir: 'H' | 'V';
  readonly mask: Board;         // derived, cached
}

export interface RuleSet {
  /** Product default uses a one-cell no-touch halo. Set true only for an explicit
   *  touching-ships room variant. */
  readonly shipsMayTouch: boolean;
  /** Standard tournament play: one shot per turn regardless of outcome. */
  readonly extraTurnOnHit: boolean;
  readonly turnSeconds: number;        // default 45
  readonly placementSeconds: number;   // default 180
  readonly disconnectGraceSeconds: number; // default 120
}

export const STANDARD_RULES: RuleSet = {
  shipsMayTouch: false,
  extraTurnOnHit: false,
  turnSeconds: 45,
  placementSeconds: 180,
  disconnectGraceSeconds: 120,
};
```

This matters for correctness of the AI: the probability-density estimator in §4.3 must
enumerate placements under the *active* rule set, or it will assign zero probability to
configurations the opponent is actually allowed to use.

## 3.3 Authoritative state

```ts
// packages/engine/src/state.ts — the full-information state, server & worker only
export interface PlayerState {
  readonly id: PlayerId;
  readonly displayName: string;      // sanitized, ≤ 24 graphemes, see §7.3
  readonly ships: readonly Ship[];   // empty until placed
  readonly fleet: Board;             // union of ship masks
  readonly incoming: Board;          // opponent's shots at this player
  readonly committed: boolean;
  readonly online: boolean;
  readonly graceEndsAt: number | null;
  readonly timeouts: number;         // consecutive turn timeouts; 3 => forfeit
  readonly isBot: boolean;
}

export interface RoomState {
  readonly id: RoomId;
  readonly code: string;             // 6-char Crockford base32, see §7.4
  readonly rules: RuleSet;
  readonly phase: Phase;             // §2.5
  readonly players: Readonly<Record<PlayerId, PlayerState>>;
  readonly order: readonly [PlayerId, PlayerId] | readonly [PlayerId];
  readonly seq: number;
  readonly rngState: number;         // seeded PRNG cursor — makes games replayable
  readonly createdAt: number;
  readonly log: readonly ShotRecord[];
}

export interface ShotRecord {
  readonly seq: number;
  readonly by: PlayerId;
  readonly cell: Cell;
  readonly outcome: 'miss' | 'hit' | 'sunk';
  readonly shipKind?: ShipKind;      // only when outcome === 'sunk'
  readonly at: number;
}
```

`RoomState` is a plain immutable structure: no class instances, no functions, no `Date`
objects. That is a hard constraint, not a style preference — it is what makes the state
snapshot-able to Redis, transferable to a Web Worker via structured clone, and hashable
for replay tests.

## 3.4 Commands and events (the wire contract)

`@bs/protocol` owns the Zod schemas; the TypeScript types are **inferred from them**, so
the validator and the type can never drift.

```ts
// packages/protocol/src/commands.ts
import { z } from 'zod';

export const CellSchema = z.number().int().min(0).max(99);
export const RoomCodeSchema = z.string().regex(/^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{6}$/);
export const ShipKindSchema = z.enum(['carrier','battleship','cruiser','submarine','destroyer']);

export const ClientCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('conn.hello'), payload: z.object({
      clientVersion: z.string().max(32),
      resumeToken: z.string().max(512).optional(),
      lastSeq: z.number().int().nonnegative().optional(),
  })}),
  z.object({ type: z.literal('room.join'), payload: z.object({
      code: RoomCodeSchema,
      displayName: z.string().trim().min(1).max(24),
  })}),
  z.object({ type: z.literal('fleet.place'), payload: z.object({
      shipId: ShipKindSchema,
      bow: CellSchema,
      dir: z.enum(['H','V']),
  })}),
  z.object({ type: z.literal('fleet.commit'), payload: z.object({
      checksum: z.string().length(64),
  })}),
  z.object({ type: z.literal('turn.fire'), payload: z.object({ cell: CellSchema })}),
  z.object({ type: z.literal('player.resign'), payload: z.object({})}),
  z.object({ type: z.literal('game.rematch'), payload: z.object({ accept: z.boolean() })}),
  z.object({ type: z.literal('emote.send'), payload: z.object({
      id: z.enum(['gg','nice','oops','hurry','thanks','wave']),
  })}),
  z.object({ type: z.literal('conn.ping'), payload: z.object({ t: z.number() })}),
]);

/** The envelope keeps the flat wire shape from §2.7 by extending every variant of the
 *  union with the envelope fields, rather than nesting the command. `.strict()` is
 *  applied per variant so unknown keys are rejected, not silently dropped. */
const ENVELOPE_FIELDS = {
  v: z.literal(1),
  cmdId: z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/),   // ULID (Crockford, no I/L/O/U)
} as const;

export const ClientEnvelopeSchema = z.discriminatedUnion(
  'type',
  ClientCommandSchema.options.map((variant) =>
    variant.extend(ENVELOPE_FIELDS).strict(),
  ) as unknown as Parameters<typeof z.discriminatedUnion>[1],
);

export type ClientCommand  = z.infer<typeof ClientCommandSchema>;
export type ClientEnvelope = z.infer<typeof ClientEnvelopeSchema>;
```

Note the shape: **no command carries a `playerId`.** Identity comes from the connection.
A payload key the schema does not declare is rejected — all object schemas are built
with `.strict()` in the compiled export, so an attacker cannot smuggle a
`{ cell: 5, playerId: 'victim' }` past a permissive parser.

## 3.5 Projected (client-visible) state

This is the only shape that ever reaches a browser in multiplayer:

```ts
// packages/protocol/src/projection.ts
export interface ProjectedRoomState {
  code: string;
  rules: RuleSet;
  phase: ProjectedPhase;
  you: {
    id: PlayerId;
    displayName: string;
    ships: OwnShip[];         // full detail — your own fleet
    incoming: string;         // hex bitboard of shots fired AT you
    committed: boolean;
  };
  opponent: {
    id: PlayerId | null;
    displayName: string | null;
    online: boolean;
    committed: boolean;
    /** Shots YOU have fired at them, and what happened. NO ship positions. */
    shotsFired: string;       // hex bitboard
    shotsHit: string;         // hex bitboard, subset of shotsFired
    sunk: ShipKind[];         // announced sinkings only
  };
  seq: number;
  serverTime: number;
}
```

There is deliberately **no field** on `opponent` that could hold ship coordinates before
game over. The type system makes the leak impossible to write accidentally; the runtime
test in [§7.2](./07-testing-security.md#the-leak-test) makes it impossible to write
deliberately without CI catching it.

Reveal at game over is a separate, explicitly-typed event:

```ts
export interface GameOverPayload {
  winner: PlayerId;
  reason: 'sunk_all' | 'forfeit' | 'timeout';
  reveal: Record<PlayerId, OwnShip[]>;   // both fleets, only now
  stats: { shots: number; hits: number; accuracy: number; durationMs: number };
}
```

## 3.6 Persistence

| Data | Store | TTL | Loss impact |
|---|---|---|---|
| `RoomState` (live) | Single server process memory | Until server restart | Active room ends; players start a new LAN room |
| Resume token | Stateless HMAC | 10 min | Player must rejoin as a new seat |
| Completed game replay | Optional Postgres (Phase 7) | — | Stats/history only |

**v1 ships with no relational database.** Persistent accounts, ELO, and replays are
Phase 7 and are additive — `ShotRecord[]` plus the room's `rngState` and initial fleets
is a complete, replayable record, so adding storage later requires no change to the
engine.
