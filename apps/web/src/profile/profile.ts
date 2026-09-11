export interface Profile {
  readonly username: string;
  readonly points: number;
  readonly played: number;
  readonly wins: number;
  readonly losses: number;
}

/** Converts both current and pre-statistics profile responses into the UI shape. */
export function profileFrom(value: unknown): Profile | null {
  if (
    value === null ||
    typeof value !== 'object' ||
    !('username' in value) ||
    typeof value.username !== 'string' ||
    !('points' in value) ||
    typeof value.points !== 'number'
  ) {
    return null;
  }
  const played = 'played' in value && typeof value.played === 'number' ? value.played : 0;
  const wins = 'wins' in value && typeof value.wins === 'number' ? value.wins : 0;
  const losses = 'losses' in value && typeof value.losses === 'number' ? value.losses : 0;
  return { username: value.username, points: value.points, played, wins, losses };
}
