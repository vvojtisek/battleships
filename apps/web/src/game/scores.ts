import type { Difficulty } from './messages.js';

export interface Score {
  readonly wins: number;
  readonly losses: number;
  readonly streak: number;
}

export type Scores = Readonly<Record<Difficulty, Score>>;

const emptyScore = (): Score => ({ wins: 0, losses: 0, streak: 0 });

export const emptyScores = (): Scores => ({
  easy: emptyScore(),
  medium: emptyScore(),
  hard: emptyScore(),
});

export function recordScore(scores: Scores, difficulty: Difficulty, won: boolean): Scores {
  const previous = scores[difficulty];
  return {
    ...scores,
    [difficulty]: won
      ? { ...previous, wins: previous.wins + 1, streak: previous.streak + 1 }
      : { ...previous, losses: previous.losses + 1, streak: 0 },
  };
}
