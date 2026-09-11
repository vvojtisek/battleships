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
  private readonly graceTimers = new Map<PlayerId, ReturnType<typeof setTimeout>>();
  private turnTimer: ReturnType<typeof setTimeout> | null = null;
  private draining = false;

  public constructor(
    private state: RoomState,
    private readonly now: () => number = Date.now,
    private readonly onGameOver?: (winner: PlayerId, matchId: string) => void,
  ) {}

  public attach(connection: Connection): void {
    this.connections.set(connection.playerId, connection);
    this.clearGraceTimer(connection.playerId);
    this.updateConnection(connection.playerId, true);
    this.syncTurnTimer();
    connection.send({
      type: 'room.snapshot',
      state: projectRoom(this.state, connection.playerId, this.now()),
    });
  }

  public detach(player: PlayerId): void {
    this.connections.delete(player);
    this.updateConnection(player, false);
    this.syncTurnTimer();
    const playerState = this.state.players[player];
    if (!playerState?.graceEndsAt || this.state.phase.kind !== 'in_game') return;
    const delay = Math.max(0, playerState.graceEndsAt - this.now());
    const timer = setTimeout(() => {
      this.expireDisconnectedPlayer(player);
    }, delay);
    timer.unref();
    this.graceTimers.set(player, timer);
  }

  public hasPlayer(player: PlayerId): boolean {
    return this.state.players[player] !== undefined;
  }

  public isJoinable(): boolean {
    return this.state.phase.kind === 'lobby' && this.state.order.length === 1;
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
    for (const event of result.value.events) {
      if (event.type === 'game.over') this.onGameOver?.(event.winner, this.state.id);
    }
    this.broadcast(cmdId);
    this.syncTurnTimer();
    this.seen.set(cmdId, [
      { type: 'room.snapshot', state: projectRoom(this.state, from, this.now()), cmdId },
    ]);
  }

  private updateConnection(playerId: PlayerId, online: boolean): void {
    const result = reduce(this.state, {
      type: 'player.connection',
      actor: playerId,
      online,
      at: this.now(),
    });
    if (!result.ok || result.value.events.length === 0) return;
    this.state = result.value.state;
    this.broadcast();
    this.syncTurnTimer();
  }

  private expireDisconnectedPlayer(playerId: PlayerId): void {
    this.graceTimers.delete(playerId);
    const player = this.state.players[playerId];
    if (!player || player.online || this.state.phase.kind !== 'in_game') return;
    const result = reduce(this.state, { type: 'player.resign', actor: playerId });
    if (!result.ok) return;
    this.state = result.value.state;
    for (const event of result.value.events)
      if (event.type === 'game.over') this.onGameOver?.(event.winner, this.state.id);
    this.broadcast();
    this.syncTurnTimer();
  }

  private clearGraceTimer(playerId: PlayerId): void {
    const timer = this.graceTimers.get(playerId);
    if (timer) clearTimeout(timer);
    this.graceTimers.delete(playerId);
  }

  private broadcast(cmdId?: string): void {
    for (const [playerId, connection] of this.connections) {
      connection.send({
        type: 'room.snapshot',
        state: projectRoom(this.state, playerId, this.now()),
        ...(cmdId ? { cmdId } : {}),
      });
    }
  }

  private syncTurnTimer(): void {
    if (this.turnTimer) clearTimeout(this.turnTimer);
    this.turnTimer = null;
    const phase = this.state.phase;
    if (phase.kind !== 'in_game') return;
    const current = this.state.players[phase.turn];
    const opponentId = this.state.order.find((id) => id !== phase.turn);
    const opponent = opponentId ? this.state.players[opponentId] : undefined;
    if (!current?.online || !opponent?.online) return;
    const deadline = phase.turnDeadline;
    this.turnTimer = setTimeout(
      () => {
        this.expireTurn(deadline);
      },
      Math.max(0, deadline - this.now()),
    );
    this.turnTimer.unref();
  }

  private expireTurn(deadline: number): void {
    this.turnTimer = null;
    if (
      this.state.phase.kind !== 'in_game' ||
      this.state.phase.turnDeadline !== deadline ||
      deadline > this.now()
    )
      return;
    const result = reduce(this.state, { type: 'player.timeout', actor: this.state.phase.turn });
    if (!result.ok) return;
    this.state = result.value.state;
    for (const event of result.value.events)
      if (event.type === 'game.over') this.onGameOver?.(event.winner, this.state.id);
    this.broadcast();
  }
}
