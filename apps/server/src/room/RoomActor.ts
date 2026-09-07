import {
  projectRoom,
  reduce,
  type Command,
  type EngineError,
  type PlayerId,
  type ProjectedRoomState,
  type RoomState,
} from '@bs/engine';

export interface Connection {
  readonly playerId: PlayerId;
  send(message: ServerMessage): void;
}

export type ServerMessage =
  | { readonly type: 'room.snapshot'; readonly state: ProjectedRoomState; readonly cmdId?: string }
  | {
      readonly type: 'error';
      readonly code: EngineError;
      readonly detail: string;
      readonly cmdId: string;
    };

interface QueuedCommand {
  readonly from: PlayerId;
  readonly command: Command;
  readonly cmdId: string;
}

/** Serializes all room changes and is the sole server-side reducer entry point. */
export class RoomActor {
  private readonly connections = new Map<PlayerId, Connection>();
  private readonly queue: QueuedCommand[] = [];
  private readonly seen = new Map<string, readonly ServerMessage[]>();
  private draining = false;

  public constructor(
    private state: RoomState,
    private readonly now: () => number = Date.now,
  ) {}

  public attach(connection: Connection): void {
    this.connections.set(connection.playerId, connection);
    connection.send({
      type: 'room.snapshot',
      state: projectRoom(this.state, connection.playerId, this.now()),
    });
  }

  public detach(player: PlayerId): void {
    this.connections.delete(player);
  }

  public hasPlayer(player: PlayerId): boolean {
    return this.state.players[player] !== undefined;
  }

  public submit(from: PlayerId, command: Command, cmdId: string): void {
    if (command.actor !== from)
      throw new Error('command actor must match authenticated connection');
    const replay = this.seen.get(cmdId);
    if (replay) {
      const connection = this.connections.get(from);
      replay.forEach((message) => connection?.send(message));
      return;
    }
    this.queue.push({ from, command, cmdId });
    if (this.draining) return;
    this.draining = true;
    while (this.queue.length > 0) this.step(this.queue.shift()!);
    this.draining = false;
  }

  private step({ from, command, cmdId }: QueuedCommand): void {
    const result = reduce(this.state, command);
    if (!result.ok) {
      this.connections
        .get(from)
        ?.send({ type: 'error', code: result.code, detail: result.detail, cmdId });
      return;
    }
    this.state = result.value.state;
    for (const [playerId, connection] of this.connections) {
      const message: ServerMessage = {
        type: 'room.snapshot',
        state: projectRoom(this.state, playerId, this.now()),
        cmdId,
      };
      connection.send(message);
    }
    this.seen.set(cmdId, [
      { type: 'room.snapshot', state: projectRoom(this.state, from, this.now()), cmdId },
    ]);
  }
}
