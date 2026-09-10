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
});
