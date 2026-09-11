import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ProfileStore } from '../src/profile/ProfileStore.js';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe('ProfileStore legacy profile migration', () => {
  it('supplies match stats for profiles created before career stats existed', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'battleships-profile-store-'));
    directories.push(directory);
    const filePath = join(directory, 'players.json');
    const now = 1_000_000;
    await writeFile(
      filePath,
      JSON.stringify({
        version: 1,
        profiles: [
          {
            key: 'captain',
            username: 'Captain',
            points: 5,
            passwordHash: 'not-used-by-this-test',
            createdAt: 1,
          },
        ],
        sessions: [{ token: 'active-session', profileKey: 'captain', expiresAt: now + 1 }],
        entries: [],
        recordedMatchIds: [],
      }),
    );

    const store = new ProfileStore(filePath, () => now);
    await store.initialize();

    expect(store.activeUser('active-session')).toEqual({
      username: 'Captain',
      points: 5,
      played: 0,
      wins: 0,
      losses: 0,
    });
  });
});
