import { describe, expect, it } from 'vitest';
import { soundsForChange, type BattleSoundState } from '../src/game/battleSounds.js';

const initial: BattleSoundState = {
  playerShots: 0n,
  playerHits: 0n,
  enemyShots: 0n,
  enemyHits: 0n,
  playerSunk: 0,
  enemySunk: 0,
};

describe('battle sounds', () => {
  it('plays a water sound for a newly recorded miss', () => {
    expect(soundsForChange(initial, { ...initial, playerShots: 1n })).toEqual(['miss']);
  });

  it('plays a hit and then a sunk sound when a ship is destroyed', () => {
    expect(
      soundsForChange(initial, {
        ...initial,
        playerShots: 1n,
        playerHits: 1n,
        enemySunk: 1,
      }),
    ).toEqual(['hit', 'sunk']);
  });

  it('also reacts to an opponent shot on the local fleet', () => {
    expect(soundsForChange(initial, { ...initial, enemyShots: 1n, enemyHits: 1n })).toEqual([
      'hit',
    ]);
  });
});
