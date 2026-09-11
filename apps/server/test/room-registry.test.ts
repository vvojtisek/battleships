import { playerId } from '@bs/engine';
import { describe, expect, it } from 'vitest';
import { RoomRegistry } from '../src/index.js';

describe('RoomRegistry', () => {
  it('expires resume tokens after ten minutes', () => {
    let now = 0;
    const registry = new RoomRegistry(() => now);
    const room = registry.create('Ada');
    expect(registry.resume(room.resumeToken)?.playerId).toBe(room.playerId);
    now = 10 * 60 * 1000;
    expect(registry.resume(room.resumeToken)).toBeUndefined();
  });

  it('lists only lobbies that another player can join', () => {
    const registry = new RoomRegistry();
    const room = registry.create('Ada');

    expect(registry.listJoinable()).toEqual([
      { code: room.code, creatorName: 'Ada', createdAt: expect.any(Number) },
    ]);

    registry
      .find(room.code)
      ?.submit(
        playerId('bob'),
        { type: 'room.join', actor: playerId('bob'), displayName: 'Bob', at: 0 },
        'join-bob',
      );

    expect(registry.listJoinable()).toEqual([]);
  });

  it('removes an abandoned waiting room after ten minutes', () => {
    let now = 0;
    const registry = new RoomRegistry(() => now);
    const room = registry.create('Ada');
    now = 10 * 60 * 1_000;
    expect(registry.listJoinable()).toEqual([]);
    expect(registry.find(room.code)).toBeUndefined();
  });
});
