import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ProfileStore, ProfileStoreError } from '../src/profile/ProfileStore.js';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

async function store(): Promise<{ store: ProfileStore; file: string }> {
  const directory = await mkdtemp(join(tmpdir(), 'battleships-profiles-'));
  directories.push(directory);
  const file = join(directory, 'players.json');
  const profileStore = new ProfileStore(file, () => 1_000);
  await profileStore.initialize();
  return { store: profileStore, file };
}

describe('ProfileStore', () => {
  it('seeds a strictly ordered international top ten on first run', async () => {
    const { store: profileStore } = await store();
    expect(profileStore.leaderboard()).toEqual([
      { name: 'King of the Sea', points: 1_000, kind: 'seed' },
      { name: 'Greta Wellen', points: 500, kind: 'seed' },
      { name: 'Kapitán Karel', points: 250, kind: 'seed' },
      { name: 'Zofia Żagiel', points: 100, kind: 'seed' },
      { name: 'Amélie Marée', points: 50, kind: 'seed' },
      { name: 'Henry Harbor', points: 40, kind: 'seed' },
      { name: 'Lena Sturm', points: 32, kind: 'seed' },
      { name: 'Petr Vlna', points: 24, kind: 'seed' },
      { name: 'Jan Kowalski', points: 16, kind: 'seed' },
      { name: 'Camille Bleu', points: 8, kind: 'seed' },
    ]);
  });

  it('registers and authenticates a profile without storing its PIN in plain text', async () => {
    const { store: profileStore, file } = await store();
    const registered = await profileStore.register('Vlad', '1234');
    expect(registered.profile).toEqual({
      username: 'Vlad',
      points: 0,
      played: 0,
      wins: 0,
      losses: 0,
    });
    await expect(profileStore.register('vlad', '1234')).rejects.toMatchObject<ProfileStoreError>({
      code: 'USERNAME_TAKEN',
    });
    const loggedIn = await profileStore.login('VLAD', '1234');
    expect(profileStore.activeUser(loggedIn.token)).toEqual({
      username: 'Vlad',
      points: 0,
      played: 0,
      wins: 0,
      losses: 0,
    });
    expect(await readFile(file, 'utf8')).not.toContain('"password": "1234"');
  });

  it('awards player and AI wins and keeps only the ten highest entries visible', async () => {
    const { store: profileStore } = await store();
    const { profile } = await profileStore.register('Vlad', '1234');
    await profileStore.recordAiMatch('hard', 'player', profile, 'match-one');
    await profileStore.recordAiMatch('hard', 'player', profile, 'match-two');
    await profileStore.recordAiMatch('hard', 'player', profile, 'match-three');
    await profileStore.recordAiMatch('medium', 'ai', profile, 'match-four');
    expect(profileStore.leaderboard()).toContainEqual({ name: 'Vlad', points: 12, kind: 'player' });
    expect(profileStore.leaderboard()).not.toContainEqual({
      name: 'Camille Bleu',
      points: 8,
      kind: 'seed',
    });
    expect(profileStore.activeUser((await profileStore.login('Vlad', '1234')).token)).toEqual({
      username: 'Vlad',
      points: 12,
      played: 4,
      wins: 3,
      losses: 1,
    });
  });

  it('records each match id only once', async () => {
    const { store: profileStore } = await store();
    const { profile } = await profileStore.register('Vlad', '1234');
    await profileStore.recordAiMatch('hard', 'player', profile, 'same-match');
    await profileStore.recordAiMatch('hard', 'player', profile, 'same-match');
    expect(profileStore.activeUser((await profileStore.login('Vlad', '1234')).token)).toMatchObject(
      {
        points: 4,
        played: 1,
        wins: 1,
      },
    );
  });
});
