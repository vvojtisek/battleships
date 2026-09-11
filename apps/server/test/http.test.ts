import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildServer } from '../src/index.js';
import { ProfileStore } from '../src/profile/ProfileStore.js';
import { RoomRegistry } from '../src/room/RoomRegistry.js';

const servers: Awaited<ReturnType<typeof buildServer>>[] = [];
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

async function testStore(): Promise<ProfileStore> {
  const directory = await mkdtemp(join(tmpdir(), 'battleships-http-'));
  directories.push(directory);
  return new ProfileStore(join(directory, 'players.json'));
}

describe('HTTP gateway', () => {
  it('reports health without exposing implementation detail', async () => {
    const app = await buildServer();
    servers.push(app);
    const response = await app.inject('/healthz');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('creates a room with an opaque resume token', async () => {
    const app = await buildServer();
    servers.push(app);
    const response = await app.inject({
      method: 'POST',
      url: '/api/rooms',
      payload: { displayName: 'Ada' },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      code: expect.stringMatching(/^[0-9A-HJKMNP-TV-Z]{6}$/),
      playerId: expect.any(String),
      resumeToken: expect.any(String),
    });
  });

  it('lists joinable LAN rooms with their creator names only', async () => {
    const registry = new RoomRegistry();
    registry.create('Ada');
    const app = await buildServer(registry);
    servers.push(app);

    const response = await app.inject({ method: 'GET', url: '/api/rooms' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      rooms: [
        {
          code: expect.stringMatching(/^[0-9A-HJKMNP-TV-Z]{6}$/),
          creatorName: 'Ada',
        },
      ],
    });
    expect(response.body).not.toContain('resumeToken');
    expect(response.body).not.toContain('playerId');
  });

  it('rejects malformed room creation input', async () => {
    const app = await buildServer();
    servers.push(app);
    const response = await app.inject({
      method: 'POST',
      url: '/api/rooms',
      payload: { displayName: '' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'E_MALFORMED' });
  });

  it('permits room creation from the configured LAN web origin', async () => {
    const app = await buildServer(undefined, { allowedOrigins: ['http://192.168.0.211:4173'] });
    servers.push(app);
    const response = await app.inject({
      method: 'OPTIONS',
      url: '/api/rooms',
      headers: { origin: 'http://192.168.0.211:4173' },
    });
    expect(response.statusCode).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe('http://192.168.0.211:4173');
  });

  it('registers a LAN profile, persists its session, and returns the seeded top ten', async () => {
    const app = await buildServer(undefined, { profileStore: await testStore() });
    servers.push(app);
    const registered = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'Vlad', password: '1234' },
    });
    expect(registered.statusCode).toBe(201);
    const token = registered.json<{ token: string }>().token;
    const current = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(current.json()).toEqual({ profile: { username: 'Vlad', points: 0 } });
    const leaderboard = await app.inject('/api/leaderboard');
    expect(
      leaderboard.json<{ entries: readonly { name: string; points: number }[] }>().entries,
    ).toHaveLength(10);
    expect(
      leaderboard.json<{ entries: readonly { name: string; points: number }[] }>().entries[0],
    ).toEqual({
      name: 'King of the Sea',
      points: 1_000,
      kind: 'seed',
    });
  });

  it('awards the registered winner the difficulty score and awards an AI loss', async () => {
    const app = await buildServer(undefined, { profileStore: await testStore() });
    servers.push(app);
    const registered = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'Vlad', password: '1234' },
    });
    const token = registered.json<{ token: string }>().token;
    for (let match = 0; match < 3; match += 1) {
      const result = await app.inject({
        method: 'POST',
        url: '/api/scores/ai',
        headers: { authorization: `Bearer ${token}` },
        payload: { difficulty: 'hard', winner: 'player' },
      });
      expect(result.statusCode).toBe(200);
    }
    const aiResult = await app.inject({
      method: 'POST',
      url: '/api/scores/ai',
      payload: { difficulty: 'medium', winner: 'ai' },
    });
    expect(aiResult.statusCode).toBe(200);
    expect(
      aiResult.json<{ entries: readonly { name: string; points: number }[] }>().entries,
    ).toContainEqual({
      name: 'Vlad',
      points: 12,
      kind: 'player',
    });
    const current = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(current.json()).toEqual({ profile: { username: 'Vlad', points: 12 } });
  });
});
