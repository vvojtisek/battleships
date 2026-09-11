import { describe, expect, it } from 'vitest';
import { profileFrom } from '../src/profile/profile.js';

describe('profileFrom', () => {
  it('accepts legacy profile responses and supplies zeroed match stats', () => {
    expect(profileFrom({ username: 'Ada', points: 7 })).toEqual({
      username: 'Ada',
      points: 7,
      played: 0,
      wins: 0,
      losses: 0,
    });
  });

  it('retains match stats returned by the current server', () => {
    expect(profileFrom({ username: 'Ada', points: 7, played: 4, wins: 3, losses: 1 })).toEqual({
      username: 'Ada',
      points: 7,
      played: 4,
      wins: 3,
      losses: 1,
    });
  });

  it('rejects malformed profile responses', () => {
    expect(profileFrom({ username: 'Ada' })).toBeNull();
    expect(profileFrom(null)).toBeNull();
  });
});
