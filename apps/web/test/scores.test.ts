import { describe, expect, it } from 'vitest';
import { emptyScores, recordScore } from '../src/game/scores.js';

describe('local scores', () => {
  it('tracks wins, losses, and streaks independently by difficulty', () => {
    const initial = emptyScores();
    const won = recordScore(initial, 'hard', true);
    const lost = recordScore(won, 'hard', false);

    expect(initial.hard).toEqual({ wins: 0, losses: 0, streak: 0 });
    expect(won.hard).toEqual({ wins: 1, losses: 0, streak: 1 });
    expect(lost.hard).toEqual({ wins: 1, losses: 1, streak: 0 });
    expect(lost.easy).toEqual({ wins: 0, losses: 0, streak: 0 });
  });
});
