import { createRoom, playerId, reduce, roomId, type Command, type RoomState } from '@bs/engine';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RoomActor, type Connection, type ServerMessage } from '../src/index.js';

const alice = playerId('alice');
const bob = playerId('bob');
const messages = (
  player = alice,
): { readonly connection: Connection; readonly sent: ServerMessage[] } => {
  const sent: ServerMessage[] = [];
  return { connection: { playerId: player, send: (message) => sent.push(message) }, sent };
};

describe('RoomActor', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('replays an accepted command without reducing it twice', () => {
    const actor = new RoomActor(
      createRoom({
        id: roomId('room'),
        code: 'ABCDEF',
        creator: alice,
        displayName: 'Alice',
        seed: 1,
        now: 0,
      }),
      () => 10,
    );
    const first = messages();
    actor.attach(first.connection);
    const join: Command = { type: 'room.join', actor: bob, displayName: 'Bob', at: 1 };
    actor.submit(bob, join, 'join-1');
    const second = messages(bob);
    actor.attach(second.connection);
    actor.submit(bob, join, 'join-1');
    expect(second.sent.filter((message) => message.type === 'room.snapshot')).toHaveLength(2);
  });

  it('does not serialize an opponent fleet before game over', () => {
    const state = createRoom({
      id: roomId('room'),
      code: 'ABCDEF',
      creator: alice,
      displayName: 'Alice',
      seed: 1,
      now: 0,
    });
    const actor = new RoomActor(state, () => 10);
    const aliceMessages = messages();
    actor.attach(aliceMessages.connection);
    actor.submit(bob, { type: 'room.join', actor: bob, displayName: 'Bob', at: 1 }, 'join-1');
    actor.submit(bob, { type: 'fleet.random', actor: bob }, 'fleet-1');
    const latest = aliceMessages.sent.at(-1);
    expect(latest?.type).toBe('room.snapshot');
    if (latest?.type !== 'room.snapshot') throw new Error('missing snapshot');
    expect(latest.state.opponent).not.toHaveProperty('ships');
    expect(JSON.stringify(latest.state)).not.toContain('carrier');
  });

  it('reports the winner exactly once when a PvP match ends', () => {
    let state: RoomState = createRoom({
      id: roomId('room'),
      code: 'ABCDEF',
      creator: alice,
      displayName: 'Alice',
      seed: 1,
      now: 0,
    });
    const prepare = (command: Command): void => {
      const result = reduce(state, command);
      if (!result.ok) throw new Error(result.detail);
      state = result.value.state;
    };
    prepare({ type: 'room.join', actor: bob, displayName: 'Bob', at: 1 });
    prepare({ type: 'fleet.random', actor: alice });
    prepare({ type: 'fleet.random', actor: bob });
    prepare({ type: 'fleet.commit', actor: alice, at: 2 });
    prepare({ type: 'fleet.commit', actor: bob, at: 3 });
    const winners: string[] = [];
    const actor = new RoomActor(
      state,
      () => 10,
      (winner) => winners.push(winner),
    );

    actor.submit(bob, { type: 'player.resign', actor: bob }, 'resign-1');
    actor.submit(bob, { type: 'player.resign', actor: bob }, 'resign-1');

    expect(winners).toEqual(['alice']);
  });

  it('passes the first two missed turns and ends the third timeout for the same player', () => {
    vi.useFakeTimers();
    let now = 0;
    let state: RoomState = createRoom({
      id: roomId('room'),
      code: 'ABCDEF',
      creator: alice,
      displayName: 'Alice',
      seed: 1,
      now: 0,
    });
    const prepare = (command: Command): void => {
      const result = reduce(state, command);
      if (!result.ok) throw new Error(result.detail);
      state = result.value.state;
    };
    prepare({ type: 'room.join', actor: bob, displayName: 'Bob', at: 1 });
    prepare({ type: 'fleet.random', actor: alice });
    prepare({ type: 'fleet.random', actor: bob });
    prepare({ type: 'fleet.commit', actor: alice, at: 2 });
    prepare({ type: 'fleet.commit', actor: bob, at: 3 });
    if (state.phase.kind !== 'in_game') throw new Error('expected game');
    const first = state.phase.turn;
    const second = first === alice ? bob : alice;
    const winners: string[] = [];
    const actor = new RoomActor(
      state,
      () => now,
      (winner) => winners.push(winner),
    );
    const firstMessages = messages(first);
    const secondMessages = messages(second);
    actor.attach(firstMessages.connection);
    actor.attach(secondMessages.connection);

    now = 45_003;
    vi.advanceTimersByTime(45_003);
    expect(firstMessages.sent.at(-1)).toMatchObject({
      type: 'room.snapshot',
      state: { phase: { kind: 'in_game', turn: second } },
    });
    now += 45_000;
    vi.advanceTimersByTime(45_000);
    now += 45_000;
    vi.advanceTimersByTime(45_000);
    now += 45_000;
    vi.advanceTimersByTime(45_000);
    expect(winners).toEqual([]);
    now += 45_000;
    vi.advanceTimersByTime(45_000);
    expect(winners).toEqual([second]);
    expect(firstMessages.sent.at(-1)).toMatchObject({
      type: 'room.snapshot',
      state: { phase: { kind: 'game_over', winner: second, reason: 'timeout' } },
    });
  });
});
