import { afterEach, describe, expect, it } from 'vitest';
import { buildServer } from '../src/index.js';

const servers: Awaited<ReturnType<typeof buildServer>>[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

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
});
