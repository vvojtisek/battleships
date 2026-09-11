import { describe, expect, test } from 'vitest';
import {
  STANDARD_RULES,
  canonicalState,
  createRoom,
  opponentId,
  opponentOf,
  playerId,
  projectRoom,
  reduce,
  replay,
  roomId,
  stateHash,
  toCell,
  type Command,
  type PlayerId,
  type RoomState,
} from '../src/index.js';

const ONE = playerId('one');
const TWO = playerId('two');

function room(): RoomState {
  return createRoom({
    id: roomId('room'),
    code: 'ABC123',
    creator: ONE,
    displayName: 'One',
    seed: 42,
    now: 1_000,
  });
}

function apply(state: RoomState, command: Command): RoomState {
  const result = reduce(state, command);
  if (!result.ok) throw new Error(`${result.code}: ${result.detail}`);
  return result.value.state;
}

function readyRoom(rules = STANDARD_RULES): RoomState {
  let state = createRoom({
    id: roomId('room'),
    code: 'ABC123',
    creator: ONE,
    displayName: 'One',
    seed: 42,
    now: 1_000,
    rules,
  });
  state = apply(state, { type: 'room.join', actor: TWO, displayName: 'Two', at: 1_000 });
  state = apply(state, { type: 'fleet.random', actor: ONE });
  state = apply(state, { type: 'fleet.random', actor: TWO });
  state = apply(state, { type: 'fleet.commit', actor: ONE, at: 2_000 });
  return apply(state, { type: 'fleet.commit', actor: TWO, at: 2_000 });
}

describe('room reducer', () => {
  test('creates, joins, and rejects invalid joins and unknown actors', () => {
    const initial = room();
    expect(projectRoom(initial, ONE, 1).opponent.id).toBeNull();
    expect(initial.phase.kind).toBe('lobby');
    expect(initial.order).toEqual([ONE]);
    expect(opponentId(initial, ONE)).toBeNull();
    expect(opponentOf(initial, ONE)).toBeNull();
    expect(reduce(initial, { type: 'fleet.random', actor: TWO })).toMatchObject({
      ok: false,
      code: 'E_UNKNOWN_PLAYER',
    });
    expect(
      reduce(initial, { type: 'room.join', actor: ONE, displayName: 'Again', at: 1_000 }),
    ).toMatchObject({ ok: false, code: 'E_ROOM_FULL' });
    const joined = reduce(initial, {
      type: 'room.join',
      actor: TWO,
      displayName: 'Two',
      at: 2_000,
      isBot: true,
    });
    expect(joined).toMatchObject({ ok: true, value: { state: { phase: { kind: 'placing' } } } });
    if (!joined.ok) return;
    expect(
      reduce(
        { ...joined.value.state, phase: { kind: 'lobby' } },
        { type: 'room.join', actor: playerId('three'), displayName: 'Three', at: 2_000 },
      ),
    ).toMatchObject({ ok: false, code: 'E_ROOM_FULL' });
    expect(opponentId(joined.value.state, ONE)).toBe(TWO);
    expect(opponentId(joined.value.state, TWO)).toBe(ONE);
    expect(opponentId(joined.value.state, playerId('outsider'))).toBeNull();
    expect(opponentOf(joined.value.state, ONE)?.isBot).toBe(true);
    expect(
      reduce(joined.value.state, {
        type: 'room.join',
        actor: playerId('three'),
        displayName: 'Three',
        at: 2_000,
      }),
    ).toMatchObject({ ok: false, code: 'E_WRONG_PHASE' });
  });

  test('places, replaces, clears, randomizes, and commits fleets', () => {
    let state = apply(room(), { type: 'room.join', actor: TWO, displayName: 'Two', at: 1_000 });
    state = apply(state, {
      type: 'fleet.place',
      actor: ONE,
      shipKind: 'carrier',
      bow: toCell(0, 0),
      dir: 'H',
    });
    state = apply(state, {
      type: 'fleet.place',
      actor: ONE,
      shipKind: 'carrier',
      bow: toCell(1, 0),
      dir: 'H',
    });
    expect(state.players[ONE]?.ships).toHaveLength(1);
    expect(
      reduce(state, {
        type: 'fleet.place',
        actor: ONE,
        shipKind: 'battleship',
        bow: toCell(1, 0),
        dir: 'V',
      }),
    ).toMatchObject({ ok: false, code: 'E_ILLEGAL_PLACEMENT' });
    expect(
      reduce(state, {
        type: 'fleet.place',
        actor: ONE,
        shipKind: 'carrier',
        bow: toCell(9, 9),
        dir: 'H',
      }),
    ).toMatchObject({ ok: false });
    state = apply(state, { type: 'fleet.clear', actor: ONE, shipKind: 'carrier' });
    expect(state.players[ONE]?.ships).toEqual([]);
    state = apply(state, { type: 'fleet.random', actor: ONE });
    state = apply(state, { type: 'fleet.clear', actor: ONE });
    expect(state.players[ONE]?.fleet).toBe(0n);
    expect(reduce(state, { type: 'fleet.commit', actor: ONE, at: 1_000 })).toMatchObject({
      ok: false,
      code: 'E_ILLEGAL_PLACEMENT',
    });
    state = apply(state, { type: 'fleet.random', actor: ONE });
    state = apply(state, { type: 'fleet.commit', actor: ONE, at: 2_000 });
    expect(reduce(state, { type: 'fleet.clear', actor: ONE })).toMatchObject({ ok: false });
    expect(reduce(state, { type: 'fleet.random', actor: ONE })).toMatchObject({ ok: false });
    expect(
      reduce(state, {
        type: 'fleet.place',
        actor: ONE,
        shipKind: 'carrier',
        bow: toCell(0, 0),
        dir: 'H',
      }),
    ).toMatchObject({ ok: false });
    expect(reduce(state, { type: 'fleet.commit', actor: ONE, at: 2_000 })).toMatchObject({
      ok: false,
    });
    state = apply(state, { type: 'fleet.random', actor: TWO });
    state = apply(state, { type: 'fleet.commit', actor: TWO, at: 2_000 });
    expect(state.phase.kind).toBe('in_game');
    expect(reduce(state, { type: 'fleet.random', actor: ONE })).toMatchObject({
      ok: false,
      code: 'E_WRONG_PHASE',
    });
    expect(reduce(state, { type: 'fleet.clear', actor: ONE })).toMatchObject({
      ok: false,
      code: 'E_WRONG_PHASE',
    });
    expect(reduce(state, { type: 'fleet.commit', actor: ONE, at: 3_000 })).toMatchObject({
      ok: false,
      code: 'E_WRONG_PHASE',
    });
    expect(
      reduce(state, {
        type: 'fleet.place',
        actor: ONE,
        shipKind: 'carrier',
        bow: toCell(0, 0),
        dir: 'H',
      }),
    ).toMatchObject({ ok: false, code: 'E_WRONG_PHASE' });
  });

  test('enforces turns, records misses/hits/sinks, and reaches game over', () => {
    let state = readyRoom();
    if (state.phase.kind !== 'in_game') throw new Error('expected game');
    const first = state.phase.turn;
    const second = opponentId(state, first) as PlayerId;
    expect(
      reduce(state, { type: 'turn.fire', actor: second, cell: toCell(9, 9), at: 3_000 }),
    ).toMatchObject({ ok: false, code: 'E_NOT_YOUR_TURN' });
    expect(
      reduce(state, { type: 'turn.fire', actor: first, cell: 100 as never, at: 3_000 }),
    ).toMatchObject({ ok: false, code: 'E_ALREADY_FIRED' });
    const targetFleet = state.players[second]?.ships;
    if (!targetFleet) throw new Error('missing target');
    const openingMiss = Array.from({ length: 100 }, (_, index) => index as never).find(
      (candidate) => (state.players[second]!.fleet & (1n << BigInt(candidate))) === 0n,
    );
    if (openingMiss === undefined) throw new Error('no opening miss');
    state = apply(state, {
      type: 'turn.fire',
      actor: first,
      cell: openingMiss,
      at: 2_500,
    });
    let current = state.phase.kind === 'in_game' ? state.phase.turn : first;
    for (const ship of targetFleet) {
      for (const cell of Array.from({ length: 100 }, (_, index) => index as never).filter(
        (candidate) => (ship.mask & (1n << BigInt(candidate))) !== 0n,
      )) {
        if (current !== first) {
          const otherTarget = state.players[first];
          const miss = Array.from({ length: 100 }, (_, index) => index as never).find(
            (candidate) =>
              otherTarget &&
              (otherTarget.fleet & (1n << BigInt(candidate))) === 0n &&
              (otherTarget.incoming & (1n << BigInt(candidate))) === 0n,
          );
          if (miss === undefined) throw new Error('no miss');
          state = apply(state, {
            type: 'turn.fire',
            actor: current,
            cell: miss,
            at: 3_000 + state.seq,
          });
        }
        state = apply(state, { type: 'turn.fire', actor: first, cell, at: 3_000 + state.seq });
        if (state.phase.kind === 'game_over') break;
        current = state.phase.turn;
      }
    }
    expect(state.phase).toMatchObject({ kind: 'game_over', winner: first, reason: 'sunk_all' });
    expect(state.log).toHaveLength(35);
    expect(state.log.filter(({ outcome }) => outcome === 'sunk')).toHaveLength(5);
    expect(
      reduce(state, { type: 'turn.fire', actor: first, cell: toCell(0, 0), at: 9_000 }),
    ).toMatchObject({ ok: false, code: 'E_WRONG_PHASE' });
  });

  test('supports extra turns, duplicate-shot rejection, resignation, and rematch', () => {
    let state = readyRoom({ ...STANDARD_RULES, extraTurnOnHit: true });
    if (state.phase.kind !== 'in_game') throw new Error('expected game');
    const shooter = state.phase.turn;
    const target = opponentId(state, shooter) as PlayerId;
    const hit = state.players[target]?.ships[0]?.bow;
    if (hit === undefined) throw new Error('missing target ship');
    state = apply(state, { type: 'turn.fire', actor: shooter, cell: hit, at: 3_000 });
    expect(state.phase).toMatchObject({ kind: 'in_game', turn: shooter });
    expect(
      reduce(state, { type: 'turn.fire', actor: shooter, cell: hit, at: 3_001 }),
    ).toMatchObject({ ok: false, code: 'E_ALREADY_FIRED' });
    state = apply(state, { type: 'player.resign', actor: shooter });
    expect(state.phase).toMatchObject({ kind: 'game_over', winner: target, reason: 'forfeit' });
    const previousMatchId = state.id;
    state = apply(state, { type: 'game.rematch', actor: shooter, accept: false, at: 4_000 });
    expect(state.phase.kind).toBe('game_over');
    state = apply(state, { type: 'game.rematch', actor: shooter, accept: true, at: 4_000 });
    state = apply(state, { type: 'game.rematch', actor: target, accept: true, at: 4_000 });
    expect(state.phase.kind).toBe('placing');
    expect(state.id).not.toBe(previousMatchId);
    expect(state.players[shooter]?.ships).toEqual([]);
    expect(state.log).toEqual([]);
    expect(reduce(state, { type: 'player.resign', actor: shooter })).toMatchObject({
      ok: false,
      code: 'E_WRONG_PHASE',
    });
    expect(
      reduce(state, { type: 'game.rematch', actor: shooter, accept: true, at: 5_000 }),
    ).toMatchObject({ ok: false, code: 'E_WRONG_PHASE' });

    let alternate = {
      ...readyRoom(),
      firstTurnIndex: state.firstTurnIndex === 0 ? (1 as const) : (0 as const),
    };
    alternate = apply(alternate, {
      type: 'player.resign',
      actor: (alternate.phase as { turn: PlayerId }).turn,
    });
    alternate = apply(alternate, { type: 'game.rematch', actor: ONE, accept: true, at: 6_000 });
    alternate = apply(alternate, { type: 'game.rematch', actor: TWO, accept: true, at: 6_000 });
    expect(alternate.phase.kind).toBe('placing');
  });

  test('pauses shots during a disconnect and resolves an expired turn as a timeout', () => {
    let state = readyRoom();
    if (state.phase.kind !== 'in_game') throw new Error('expected game');
    const current = state.phase.turn;
    const other = opponentId(state, current) as PlayerId;
    expect(
      reduce(state, { type: 'player.connection', actor: current, online: true, at: 2_500 }),
    ).toMatchObject({ ok: true, value: { state, events: [] } });
    expect(reduce(state, { type: 'player.timeout', actor: other })).toMatchObject({
      ok: false,
      code: 'E_NOT_YOUR_TURN',
    });
    state = apply(state, { type: 'player.connection', actor: other, online: false, at: 3_000 });
    expect(projectRoom(state, current, 3_000).opponent.online).toBe(false);
    expect(
      reduce(state, { type: 'turn.fire', actor: current, cell: toCell(0, 0), at: 3_001 }),
    ).toMatchObject({ ok: false, code: 'E_WRONG_PHASE' });
    state = apply(state, { type: 'player.connection', actor: other, online: true, at: 4_000 });
    expect(state.phase).toMatchObject({ kind: 'in_game', turnDeadline: 49_000 });
    state = apply(state, { type: 'player.timeout', actor: current });
    expect(state.phase).toMatchObject({ kind: 'game_over', winner: other, reason: 'timeout' });
  });
});

describe('projection and replay', () => {
  test('projects only viewer knowledge until game over', () => {
    const state = readyRoom();
    const projected = projectRoom(state, ONE, 12_345);
    expect(projected.you.ships).toHaveLength(5);
    expect(projected.opponent).not.toHaveProperty('ships');
    expect(projected).not.toHaveProperty('reveal');
    expect(projected.serverTime).toBe(12_345);
    expect(() => projectRoom(state, playerId('outsider'), 1)).toThrow('viewer');
    if (state.phase.kind !== 'in_game') throw new Error('expected game');
    const afterShot = apply(state, {
      type: 'turn.fire',
      actor: state.phase.turn,
      cell: toCell(0, 0),
      at: 12_346,
    });
    expect(projectRoom(afterShot, ONE, 12_346).latestShot).toEqual(afterShot.log.at(-1));
    const resigned = apply(state, { type: 'player.resign', actor: ONE });
    expect(projectRoom(resigned, ONE, 1).reveal?.[TWO]).toHaveLength(5);
  });

  test('replays commands deterministically and hashes bigint state', () => {
    const initial = room();
    const commands: Command[] = [{ type: 'room.join', actor: TWO, displayName: 'Two', at: 1_000 }];
    const final = replay(initial, commands);
    expect(final).toEqual(apply(initial, commands[0] as Command));
    expect(canonicalState(final)).toContain('$bigint');
    expect(stateHash(final)).toBe(stateHash(final));
    expect(() =>
      replay(initial, [{ type: 'turn.fire', actor: ONE, cell: toCell(0, 0), at: 1_000 }]),
    ).toThrow('E_WRONG_PHASE');
  });
});
