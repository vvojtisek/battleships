import { randomUUID } from 'node:crypto';
import websocket from '@fastify/websocket';
import { playerId, type Cell, type Command, type PlayerId } from '@bs/engine';
import { ClientEnvelopeSchema, type ClientEnvelope } from '@bs/protocol';
import Fastify, { type FastifyInstance } from 'fastify';
import { type Connection, type ServerMessage } from '../room/RoomActor.js';
import { RoomRegistry } from '../room/RoomRegistry.js';

const MAX_FRAME_BYTES = 4 * 1024;

export interface ServerOptions {
  readonly allowedOrigins?: readonly string[];
}

interface SocketSession {
  hello: boolean;
  playerId?: PlayerId;
  code?: string;
}

class TokenBucket {
  private tokens = 20;
  private updatedAt = Date.now();

  public take(now = Date.now()): boolean {
    this.tokens = Math.min(20, this.tokens + ((now - this.updatedAt) / 1000) * 10);
    this.updatedAt = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

function parseJson(raw: string): unknown {
  return JSON.parse(raw, (key, value: unknown) =>
    key === '__proto__' || key === 'constructor' || key === 'prototype' ? undefined : value,
  );
}

function commandFrom(envelope: ClientEnvelope, actor: PlayerId): Command | null {
  switch (envelope.type) {
    case 'fleet.place':
      return {
        type: 'fleet.place',
        actor,
        shipKind: envelope.payload.shipId,
        bow: envelope.payload.bow as Cell,
        dir: envelope.payload.dir,
      };
    case 'fleet.commit':
      return { type: 'fleet.commit', actor, at: Date.now() };
    case 'turn.fire':
      return { type: 'turn.fire', actor, cell: envelope.payload.cell as Cell, at: Date.now() };
    case 'player.resign':
      return { type: 'player.resign', actor };
    case 'game.rematch':
      return { type: 'game.rematch', actor, accept: envelope.payload.accept, at: Date.now() };
    default:
      return null;
  }
}

function displayName(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 24
    ? value.trim()
    : null;
}

export async function buildServer(
  registry = new RoomRegistry(),
  options: ServerOptions = {},
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, bodyLimit: MAX_FRAME_BYTES });
  const allowedOrigins = new Set(options.allowedOrigins ?? ['http://localhost:5173']);
  await app.register(websocket, {
    options: { maxPayload: MAX_FRAME_BYTES, perMessageDeflate: false },
  });

  app.get('/healthz', () => ({ status: 'ok' }));
  app.post('/api/rooms', async (request, reply) => {
    const name = displayName((request.body as { displayName?: unknown } | undefined)?.displayName);
    if (!name)
      return reply.code(400).send({ code: 'E_MALFORMED', detail: 'displayName is required' });
    const room = registry.create(name);
    return reply
      .code(201)
      .send({ code: room.code, playerId: room.playerId, resumeToken: room.resumeToken });
  });

  app.get('/ws', { websocket: true }, (socket, request) => {
    const origin = request.headers.origin;
    if (origin && !allowedOrigins.has(origin)) return socket.close(4403, 'origin rejected');
    const session: SocketSession = { hello: false };
    const bucket = new TokenBucket();
    const helloTimeout = setTimeout(() => {
      if (!session.hello) socket.close(4408, 'hello timeout');
    }, 5_000);
    const send = (message: ServerMessage | Record<string, unknown>) =>
      socket.send(JSON.stringify(message));
    const close = (code: number, detail: string) => socket.close(code, detail);

    socket.on('message', (raw: Buffer, isBinary: boolean) => {
      if (isBinary || Buffer.byteLength(raw) > MAX_FRAME_BYTES)
        return close(4400, 'frame rejected');
      if (!bucket.take()) return close(4429, 'rate limit');
      let parsed: unknown;
      try {
        parsed = parseJson(raw.toString());
      } catch {
        return close(4400, 'malformed json');
      }
      const envelope = ClientEnvelopeSchema.safeParse(parsed);
      if (!envelope.success)
        return send({ type: 'error', code: 'E_MALFORMED', detail: 'invalid envelope' });
      handleEnvelope(envelope.data, session, registry, send, close);
    });
    socket.on('close', () => {
      clearTimeout(helloTimeout);
      if (session.playerId && session.code) registry.find(session.code)?.detach(session.playerId);
    });
  });
  return app;
}

function handleEnvelope(
  envelope: ClientEnvelope,
  session: SocketSession,
  registry: RoomRegistry,
  send: (message: ServerMessage | Record<string, unknown>) => void,
  close: (code: number, detail: string) => void,
): void {
  if (envelope.type === 'conn.hello') {
    if (session.hello) return close(4400, 'duplicate hello');
    session.hello = true;
    if (!envelope.payload.resumeToken) return send({ type: 'conn.ready', playerId: null });
    const resumed = registry.resume(envelope.payload.resumeToken);
    if (!resumed) return close(4401, 'invalid resume token');
    session.playerId = resumed.playerId;
    session.code = resumed.code;
    const connection: Connection = { playerId: resumed.playerId, send };
    resumed.actor.attach(connection);
    return send({ type: 'conn.ready', playerId: resumed.playerId, roomCode: resumed.code });
  }
  if (!session.hello) return close(4408, 'hello required');
  if (envelope.type === 'room.join') {
    if (session.playerId) return close(4400, 'already in a room');
    const actor = registry.find(envelope.payload.code);
    if (!actor)
      return send({
        type: 'error',
        code: 'E_ROOM_NOT_FOUND',
        detail: 'room not found',
        cmdId: envelope.cmdId,
      });
    const player = playerId(randomUUID());
    actor.submit(
      player,
      {
        type: 'room.join',
        actor: player,
        displayName: envelope.payload.displayName,
        at: Date.now(),
      },
      envelope.cmdId,
    );
    if (!actor.hasPlayer(player))
      return send({
        type: 'error',
        code: 'E_ROOM_FULL',
        detail: 'room already has two players',
        cmdId: envelope.cmdId,
      });
    const token = registry.issueToken(envelope.payload.code, player);
    if (!token)
      return send({
        type: 'error',
        code: 'E_INTERNAL',
        detail: 'room vanished',
        cmdId: envelope.cmdId,
      });
    session.playerId = player;
    session.code = envelope.payload.code;
    actor.attach({ playerId: player, send });
    return send({
      type: 'conn.ready',
      playerId: player,
      roomCode: session.code,
      resumeToken: token,
    });
  }
  if (!session.playerId || !session.code)
    return send({
      type: 'error',
      code: 'E_AUTH',
      detail: 'join a room first',
      cmdId: envelope.cmdId,
    });
  const command = commandFrom(envelope, session.playerId);
  if (!command)
    return send({
      type: 'error',
      code: 'E_MALFORMED',
      detail: 'unsupported command',
      cmdId: envelope.cmdId,
    });
  registry.find(session.code)?.submit(session.playerId, command, envelope.cmdId);
}
