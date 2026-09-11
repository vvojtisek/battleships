import type { ProjectedRoomState } from '@bs/engine';
import type { PlayerCommand } from './messages.js';

const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export type RemoteEvent =
  | {
      readonly type: 'conn.ready';
      readonly playerId: string | null;
      readonly roomCode?: string;
      readonly resumeToken?: string;
    }
  | { readonly type: 'room.snapshot'; readonly state: ProjectedRoomState; readonly cmdId?: string }
  | {
      readonly type: 'error';
      readonly code: string;
      readonly detail: string;
      readonly cmdId?: string;
    }
  | { readonly type: 'connection.closed'; readonly detail: string };

function commandId(): string {
  return Array.from(
    { length: 26 },
    () => alphabet[Math.floor(Math.random() * alphabet.length)],
  ).join('');
}

function websocketUrl(serverUrl: string): string {
  const url = new URL('/ws', serverUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

export class RemoteTransport {
  private socket: WebSocket | null = null;
  private readonly handlers = new Set<(event: RemoteEvent) => void>();

  public constructor(
    private readonly serverUrl: string,
    private readonly resumeToken?: string,
  ) {}

  public connect(): void {
    this.socket?.close();
    const socket = new WebSocket(websocketUrl(this.serverUrl));
    this.socket = socket;
    socket.addEventListener('open', () => {
      this.sendEnvelope('conn.hello', {
        clientVersion: 'battleships-lan',
        ...(this.resumeToken ? { resumeToken: this.resumeToken } : {}),
      });
    });
    socket.addEventListener('message', (event) => {
      let message: unknown;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        this.emit({ type: 'error', code: 'E_MALFORMED', detail: 'Server sent invalid JSON.' });
        return;
      }
      if (message && typeof message === 'object' && 'type' in message) {
        const type = message.type;
        if (type === 'conn.ready' || type === 'room.snapshot' || type === 'error') {
          this.emit(message as RemoteEvent);
        }
      }
    });
    socket.addEventListener('close', (event) => {
      if (this.socket === socket) {
        this.socket = null;
        this.emit({ type: 'connection.closed', detail: event.reason || 'Connection closed.' });
      }
    });
  }

  public join(code: string, displayName: string, sessionToken?: string): void {
    this.sendEnvelope('room.join', {
      code,
      displayName,
      ...(sessionToken ? { sessionToken } : {}),
    });
  }

  public send(command: PlayerCommand): void {
    switch (command.type) {
      case 'fleet.place':
        this.sendEnvelope('fleet.place', {
          shipId: command.shipKind,
          bow: command.bow,
          dir: command.dir,
        });
        return;
      case 'fleet.random':
      case 'fleet.clear':
        this.sendEnvelope(command.type, {});
        return;
      case 'fleet.commit':
        this.sendEnvelope('fleet.commit', { checksum: '0'.repeat(64) });
        return;
      case 'turn.fire':
        this.sendEnvelope('turn.fire', { cell: command.cell });
        return;
      case 'player.resign':
        this.sendEnvelope('player.resign', {});
        return;
      case 'game.rematch':
        this.sendEnvelope('game.rematch', { accept: command.accept });
        return;
    }
  }

  public onEvent(handler: (event: RemoteEvent) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  public close(): void {
    this.socket?.close();
    this.socket = null;
    this.handlers.clear();
  }

  private emit(event: RemoteEvent): void {
    for (const handler of this.handlers) handler(event);
  }

  private sendEnvelope(type: string, payload: Record<string, unknown>): void {
    if (this.socket?.readyState !== WebSocket.OPEN) {
      this.emit({ type: 'error', code: 'E_CONNECTION', detail: 'Connection is not ready.' });
      return;
    }
    this.socket.send(JSON.stringify({ v: 1, cmdId: commandId(), type, payload }));
  }
}
