import { bit, has } from './board.js';
import { isCell, type Cell } from './coords.js';
import { makeRng } from './rng.js';
import { err, ok, type Result } from './result.js';
import type { Direction, ShipKind } from './ships.js';
import {
  emptyPlayer,
  opponentId,
  type Phase,
  type PlayerId,
  type PlayerState,
  type RoomState,
  type ShotRecord,
} from './state.js';
import { isLegalFleetDraft, makeShip, randomFleet, validateFleet } from './placement.js';

export type Command =
  | {
      readonly type: 'room.join';
      readonly actor: PlayerId;
      readonly displayName: string;
      readonly at: number;
      readonly isBot?: boolean;
    }
  | {
      readonly type: 'fleet.place';
      readonly actor: PlayerId;
      readonly shipKind: ShipKind;
      readonly bow: Cell;
      readonly dir: Direction;
    }
  | { readonly type: 'fleet.random'; readonly actor: PlayerId }
  | { readonly type: 'fleet.clear'; readonly actor: PlayerId; readonly shipKind?: ShipKind }
  | { readonly type: 'fleet.commit'; readonly actor: PlayerId; readonly at: number }
  | {
      readonly type: 'turn.fire';
      readonly actor: PlayerId;
      readonly cell: Cell;
      readonly at: number;
    }
  | { readonly type: 'player.resign'; readonly actor: PlayerId }
  | {
      readonly type: 'game.rematch';
      readonly actor: PlayerId;
      readonly accept: boolean;
      readonly at: number;
    };

export type EngineError =
  | 'E_ROOM_FULL'
  | 'E_WRONG_PHASE'
  | 'E_UNKNOWN_PLAYER'
  | 'E_ILLEGAL_PLACEMENT'
  | 'E_NOT_YOUR_TURN'
  | 'E_ALREADY_FIRED';

export type EngineEvent =
  | { readonly type: 'player.joined'; readonly playerId: PlayerId }
  | { readonly type: 'phase.changed'; readonly phase: Phase }
  | { readonly type: 'fleet.updated'; readonly playerId: PlayerId }
  | { readonly type: 'fleet.committed'; readonly playerId: PlayerId }
  | { readonly type: 'game.started'; readonly firstTurn: PlayerId }
  | { readonly type: 'shot.result'; readonly shot: ShotRecord }
  | {
      readonly type: 'ship.sunk';
      readonly playerId: PlayerId;
      readonly shipKind: ShipKind;
      readonly cells: readonly Cell[];
    }
  | {
      readonly type: 'game.over';
      readonly winner: PlayerId;
      readonly reason: 'sunk_all' | 'forfeit' | 'timeout';
    };

export interface ReduceSuccess {
  readonly state: RoomState;
  readonly events: readonly EngineEvent[];
}

export type ReduceResult = Result<ReduceSuccess, EngineError>;

function updatePlayer(state: RoomState, player: PlayerState): RoomState {
  return { ...state, players: { ...state.players, [player.id]: player } };
}

function wrongPhase(state: RoomState, expected: string): ReduceResult {
  return err('E_WRONG_PHASE', `expected ${expected}, got ${state.phase.kind}`);
}

function requirePlayer(state: RoomState, actor: PlayerId): PlayerState | null {
  return state.players[actor] ?? null;
}

function nextSequence(state: RoomState): number {
  return state.seq + 1;
}

function startGame(state: RoomState, at: number): ReduceSuccess {
  /* v8 ignore next */
  if (state.order.length !== 2) throw new Error('cannot start without two players');
  const rng = makeRng(state.rngState);
  const firstTurnIndex = rng.int(2) as 0 | 1;
  const turn = state.order[firstTurnIndex];
  const phase: Phase = {
    kind: 'in_game',
    turn,
    turnDeadline: at + state.rules.turnSeconds * 1000,
    turnNo: 1,
  };
  return {
    state: { ...state, phase, rngState: rng.state(), firstTurnIndex, seq: nextSequence(state) },
    events: [
      { type: 'phase.changed', phase: { kind: 'ready' } },
      { type: 'game.started', firstTurn: turn },
      { type: 'phase.changed', phase },
    ],
  };
}

export function reduce(state: RoomState, command: Command): ReduceResult {
  if (command.type === 'room.join') {
    if (state.phase.kind !== 'lobby') return wrongPhase(state, 'lobby');
    if (state.order.length === 2) return err('E_ROOM_FULL', 'room already has two players');
    if (state.players[command.actor]) return err('E_ROOM_FULL', 'player already joined');
    const player = emptyPlayer(command.actor, command.displayName, command.isBot ?? false);
    const phase: Phase = {
      kind: 'placing',
      deadline: command.at + state.rules.placementSeconds * 1000,
    };
    return ok({
      state: {
        ...state,
        players: { ...state.players, [command.actor]: player },
        order: [state.order[0], command.actor],
        phase,
        seq: nextSequence(state),
      },
      events: [
        { type: 'player.joined', playerId: command.actor },
        { type: 'phase.changed', phase },
      ],
    });
  }

  const player = requirePlayer(state, command.actor);
  if (!player) return err('E_UNKNOWN_PLAYER', 'actor is not in this room');

  if (command.type === 'fleet.place') {
    if (state.phase.kind !== 'placing') return wrongPhase(state, 'placing');
    if (player.committed) return err('E_ILLEGAL_PLACEMENT', 'fleet is committed');
    const replacement = makeShip(command.shipKind, command.bow, command.dir);
    const ships = [...player.ships.filter(({ kind }) => kind !== command.shipKind), replacement];
    if (replacement.mask === 0n || !isLegalFleetDraft(ships, state.rules)) {
      return err('E_ILLEGAL_PLACEMENT', 'ship collides or is off-board');
    }
    const updated = { ...player, ships, fleet: ships.reduce((mask, ship) => mask | ship.mask, 0n) };
    return ok({
      state: { ...updatePlayer(state, updated), seq: nextSequence(state) },
      events: [{ type: 'fleet.updated', playerId: player.id }],
    });
  }

  if (command.type === 'fleet.random') {
    if (state.phase.kind !== 'placing') return wrongPhase(state, 'placing');
    if (player.committed) return err('E_ILLEGAL_PLACEMENT', 'fleet is committed');
    const rng = makeRng(state.rngState);
    const ships = randomFleet(rng, state.rules);
    const fleet = ships.reduce((mask, ship) => mask | ship.mask, 0n);
    const updated = { ...player, ships, fleet };
    return ok({
      state: { ...updatePlayer(state, updated), rngState: rng.state(), seq: nextSequence(state) },
      events: [{ type: 'fleet.updated', playerId: player.id }],
    });
  }

  if (command.type === 'fleet.clear') {
    if (state.phase.kind !== 'placing') return wrongPhase(state, 'placing');
    if (player.committed) return err('E_ILLEGAL_PLACEMENT', 'fleet is committed');
    const ships = command.shipKind
      ? player.ships.filter(({ kind }) => kind !== command.shipKind)
      : [];
    const fleet = ships.reduce((mask, ship) => mask | ship.mask, 0n);
    const updated = { ...player, ships, fleet };
    return ok({
      state: { ...updatePlayer(state, updated), seq: nextSequence(state) },
      events: [{ type: 'fleet.updated', playerId: player.id }],
    });
  }

  if (command.type === 'fleet.commit') {
    if (state.phase.kind !== 'placing') return wrongPhase(state, 'placing');
    if (player.committed) return err('E_ILLEGAL_PLACEMENT', 'fleet already committed');
    const validation = validateFleet(player.ships, state.rules);
    if (!validation.ok) return validation;
    const committed = { ...player, committed: true, fleet: validation.value };
    const next = { ...updatePlayer(state, committed), seq: nextSequence(state) };
    const everyoneReady =
      next.order.length === 2 && next.order.every((id) => next.players[id]?.committed === true);
    if (!everyoneReady)
      return ok({ state: next, events: [{ type: 'fleet.committed', playerId: player.id }] });
    const started = startGame(next, command.at);
    return ok({
      state: started.state,
      events: [{ type: 'fleet.committed', playerId: player.id }, ...started.events],
    });
  }

  if (command.type === 'turn.fire') {
    if (state.phase.kind !== 'in_game') return wrongPhase(state, 'in_game');
    if (state.phase.turn !== command.actor) return err('E_NOT_YOUR_TURN', 'opponent owns the turn');
    if (!isCell(command.cell)) return err('E_ALREADY_FIRED', 'cell is outside the board');
    const targetId = opponentId(state, command.actor);
    /* v8 ignore next */
    if (targetId === null) return err('E_WRONG_PHASE', 'opponent is missing');
    const target = state.players[targetId];
    /* v8 ignore next */
    if (!target) return err('E_WRONG_PHASE', 'opponent is missing');
    if (has(target.incoming, command.cell))
      return err('E_ALREADY_FIRED', 'cell was already fired at');
    const incoming = target.incoming | bit(command.cell);
    const hit = has(target.fleet, command.cell);
    const sunkShip = hit
      ? target.ships.find(
          (ship) =>
            (ship.mask & incoming) === ship.mask && (ship.mask & target.incoming) !== ship.mask,
        )
      : undefined;
    const outcome = sunkShip ? 'sunk' : hit ? 'hit' : 'miss';
    const seq = nextSequence(state);
    const shot: ShotRecord = {
      seq,
      by: command.actor,
      cell: command.cell,
      outcome,
      ...(sunkShip ? { shipKind: sunkShip.kind } : {}),
      at: command.at,
    };
    const updatedTarget = { ...target, incoming };
    const won = (incoming & target.fleet) === target.fleet;
    const nextTurn = state.rules.extraTurnOnHit && hit ? command.actor : targetId;
    const phase: Phase = won
      ? { kind: 'game_over', winner: command.actor, reason: 'sunk_all' }
      : {
          kind: 'in_game',
          turn: nextTurn,
          turnDeadline: command.at + state.rules.turnSeconds * 1000,
          turnNo: state.phase.turnNo + 1,
        };
    const next = { ...updatePlayer(state, updatedTarget), phase, seq, log: [...state.log, shot] };
    const events: EngineEvent[] = [{ type: 'shot.result', shot }];
    if (sunkShip)
      events.push({
        type: 'ship.sunk',
        playerId: targetId,
        shipKind: sunkShip.kind,
        cells: cellsFromMask(sunkShip.mask),
      });
    if (won) events.push({ type: 'game.over', winner: command.actor, reason: 'sunk_all' });
    else events.push({ type: 'phase.changed', phase });
    return ok({ state: next, events });
  }

  if (command.type === 'player.resign') {
    if (state.phase.kind !== 'in_game') return wrongPhase(state, 'in_game');
    const winner = opponentId(state, command.actor);
    /* v8 ignore next */
    if (winner === null) return err('E_WRONG_PHASE', 'opponent is missing');
    const phase: Phase = { kind: 'game_over', winner, reason: 'forfeit' };
    return ok({
      state: { ...state, phase, seq: nextSequence(state) },
      events: [{ type: 'game.over', winner, reason: 'forfeit' }],
    });
  }

  if (state.phase.kind !== 'game_over') return wrongPhase(state, 'game_over');
  const accepted = { ...player, rematch: command.accept };
  let next = updatePlayer(state, accepted);
  const bothAccepted =
    next.order.length === 2 && next.order.every((id) => next.players[id]?.rematch === true);
  if (!bothAccepted) return ok({ state: { ...next, seq: nextSequence(next) }, events: [] });
  const players = Object.fromEntries(
    next.order.map((id) => {
      const old = next.players[id];
      /* v8 ignore next */
      if (!old) throw new Error('missing player during rematch');
      return [
        id,
        {
          ...old,
          ships: [],
          fleet: 0n,
          incoming: 0n,
          committed: false,
          timeouts: 0,
          rematch: false,
        },
      ];
    }),
  ) as Record<PlayerId, PlayerState>;
  const phase: Phase = {
    kind: 'placing',
    deadline: command.at + next.rules.placementSeconds * 1000,
  };
  next = {
    ...next,
    players,
    phase,
    firstTurnIndex: (1 - next.firstTurnIndex) as 0 | 1,
    seq: nextSequence(next),
    log: [],
  };
  return ok({ state: next, events: [{ type: 'phase.changed', phase }] });
}

function cellsFromMask(mask: bigint): Cell[] {
  const cells: Cell[] = [];
  for (let index = 0; index < 100; index += 1)
    if ((mask & (1n << BigInt(index))) !== 0n) cells.push(index as Cell);
  return cells;
}
