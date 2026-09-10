import type { AddressInfo } from 'node:net';
import WebSocket from 'ws';
import { afterEach, describe, expect, it } from 'vitest';
import { buildServer } from '../src/index.js';

const apps: Awaited<ReturnType<typeof buildServer>>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function receive(url: string, frames: readonly object[]): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const messages: unknown[] = [];
    const socket = new WebSocket(url);
    socket.once('error', reject);
    socket.on('open', () => frames.forEach((frame) => socket.send(JSON.stringify(frame))));
    socket.on('message', (raw) => {
      messages.push(JSON.parse(raw.toString()) as unknown);
      if (
        messages.some(
          (message) =>
            (message as { type?: string; playerId?: string | null }).type === 'conn.ready' &&
            (message as { playerId?: string | null }).playerId !== null,
        )
      ) {
        socket.close();
        resolve(messages);
      }
    });
  });
}

function closeCode(url: string, origin: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { origin });
    socket.once('error', reject);
    socket.once('close', (code) => resolve(code));
  });
}

describe('WebSocket gateway', () => {
  it('resumes a created room and returns only its projected snapshot', async () => {
    const app = await buildServer();
    apps.push(app);
    const created = await app.inject({
      method: 'POST',
      url: '/api/rooms',
      payload: { displayName: 'Ada' },
    });
    const room = created.json();
    await app.listen({ host: '127.0.0.1', port: 0 });
    const { port } = app.server.address() as AddressInfo;
    const messages = await receive(`ws://127.0.0.1:${port}/ws`, [
      {
        v: 1,
        cmdId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
        type: 'conn.hello',
        payload: { clientVersion: 'test', resumeToken: room.resumeToken },
      },
    ]);
    expect(messages).toContainEqual(expect.objectContaining({ type: 'conn.ready' }));
    const snapshot = messages.find(
      (message) => (message as { type?: string }).type === 'room.snapshot',
    ) as { state: { opponent: unknown } };
    expect(snapshot.state.opponent).not.toHaveProperty('ships');
  });

  it('lets a second authenticated socket join without disclosing fleet cells', async () => {
    const app = await buildServer();
    apps.push(app);
    const created = await app.inject({
      method: 'POST',
      url: '/api/rooms',
      payload: { displayName: 'Ada' },
    });
    const room = created.json();
    await app.listen({ host: '127.0.0.1', port: 0 });
    const { port } = app.server.address() as AddressInfo;
    const url = `ws://127.0.0.1:${port}/ws`;
    await receive(url, [
      {
        v: 1,
        cmdId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
        type: 'conn.hello',
        payload: { clientVersion: 'test', resumeToken: room.resumeToken },
      },
    ]);
    const joined = await receive(url, [
      {
        v: 1,
        cmdId: '01ARZ3NDEKTSV4RRFFQ69G5FAW',
        type: 'conn.hello',
        payload: { clientVersion: 'test' },
      },
      {
        v: 1,
        cmdId: '01ARZ3NDEKTSV4RRFFQ69G5FAX',
        type: 'room.join',
        payload: { code: room.code, displayName: 'Lin' },
      },
    ]);
    const snapshot = joined.find(
      (message) => (message as { type?: string }).type === 'room.snapshot',
    ) as {
      state: { opponent: { displayName: string | null } };
    };
    expect(snapshot.state.opponent.displayName).toBe('Ada');
    expect(snapshot.state.opponent).not.toHaveProperty('ships');
  });

  it('rejects browser sockets from an untrusted origin', async () => {
    const app = await buildServer();
    apps.push(app);
    await app.listen({ host: '127.0.0.1', port: 0 });
    const { port } = app.server.address() as AddressInfo;
    await expect(closeCode(`ws://127.0.0.1:${port}/ws`, 'https://attacker.invalid')).resolves.toBe(
      4403,
    );
  });
});
