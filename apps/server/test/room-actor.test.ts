import { createRoom, playerId, roomId, type Command } from '@bs/engine';
import { describe, expect, it } from 'vitest';
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
});
