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

const MAX_SEEN_COMMANDS = 256;

/** Serializes all room changes and is the sole server-side reducer entry point. */
export class RoomActor {
  private readonly connections = new Map<PlayerId, Connection>();
  private readonly queue: QueuedCommand[] = [];
  private readonly seen = new Map<string, readonly ServerMessage[]>();
  private readonly seenOrder: string[] = [];
  private readonly graceTimers = new Map<PlayerId, ReturnType<typeof setTimeout>>();
  private turnTimer: ReturnType<typeof setTimeout> | null = null;
  private placementTimer: ReturnType<typeof setTimeout> | null = null;
  private rematchTimer: ReturnType<typeof setTimeout> | null = null;
  private draining = false;

  public constructor(
    private state: RoomState,
    private readonly now: () => number = Date.now,
    private readonly onGameOver?: (winner: PlayerId, matchId: string) => void,
    private readonly onClosed?: (matchId: string) => void,
  ) {}

  public attach(connection: Connection): void {
    this.connections.set(connection.playerId, connection);
    this.clearGraceTimer(connection.playerId);
    this.updateConnection(connection.playerId, true);
    this.syncTimers();
    connection.send({
      type: 'room.snapshot',
      state: projectRoom(this.state, connection.playerId, this.now()),
    });
  }

  public detach(player: PlayerId): void {
    this.connections.delete(player);
    this.updateConnection(player, false);
    this.syncTimers();
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
    this.syncTimers();
    this.remember(cmdId, [
      { type: 'room.snapshot', state: projectRoom(this.state, from, this.now()), cmdId },
    ]);
  }

  private remember(cmdId: string, messages: readonly ServerMessage[]): void {
    this.seen.set(cmdId, messages);
    this.seenOrder.push(cmdId);
    if (this.seenOrder.length <= MAX_SEEN_COMMANDS) return;
    const oldest = this.seenOrder.shift();
    if (oldest !== undefined) this.seen.delete(oldest);
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
    this.syncTimers();
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
    this.syncTimers();
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

  private syncTimers(): void {
    if (this.turnTimer) clearTimeout(this.turnTimer);
    if (this.placementTimer) clearTimeout(this.placementTimer);
    if (this.rematchTimer) clearTimeout(this.rematchTimer);
    this.turnTimer = null;
    this.placementTimer = null;
    this.rematchTimer = null;
    const phase = this.state.phase;
    if (phase.kind === 'placing') {
      const deadline = phase.deadline;
      this.placementTimer = setTimeout(
        () => {
          this.expirePlacement(deadline);
        },
        Math.max(0, deadline - this.now()),
      );
      this.placementTimer.unref();
      return;
    }
    if (phase.kind === 'game_over') {
      const pending = this.state.order
        .map((id) => this.state.players[id]!)
        .filter((player) => player.rematch && player.rematchRequestedAt !== null)
        .sort((left, right) => left.rematchRequestedAt! - right.rematchRequestedAt!)[0];
      if (pending === undefined) return;
      const requestedAt = pending.rematchRequestedAt;
      if (requestedAt === null) return;
      const deadline = requestedAt + 5 * 60 * 1_000;
      this.rematchTimer = setTimeout(
        () => {
          this.expireRematch(pending.id, deadline);
        },
        Math.max(0, deadline - this.now()),
      );
      this.rematchTimer.unref();
      return;
    }
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

  private expirePlacement(deadline: number): void {
    this.placementTimer = null;
    if (
      this.state.phase.kind !== 'placing' ||
      this.state.phase.deadline !== deadline ||
      deadline > this.now()
    )
      return;
    const actor = this.state.order[0];
    if (!actor) return;
    const result = reduce(this.state, { type: 'placement.timeout', actor, at: deadline });
    if (!result.ok) return;
    this.state = result.value.state;
    this.broadcast();
    this.onClosed?.(this.state.id);
    this.syncTimers();
  }

  private expireRematch(actor: PlayerId, deadline: number): void {
    this.rematchTimer = null;
    const player = this.state.players[actor];
    if (
      this.state.phase.kind !== 'game_over' ||
      player?.rematchRequestedAt === null ||
      player?.rematchRequestedAt === undefined ||
      player.rematchRequestedAt + 5 * 60 * 1_000 !== deadline ||
      deadline > this.now()
    )
      return;
    const result = reduce(this.state, { type: 'game.rematch', actor, accept: false, at: deadline });
    if (!result.ok) return;
    this.state = result.value.state;
    this.broadcast();
    this.syncTimers();
  }

  private expireTurn(deadline: number): void {
    this.turnTimer = null;
    if (
      this.state.phase.kind !== 'in_game' ||
      this.state.phase.turnDeadline !== deadline ||
      deadline > this.now()
    )
      return;
    const result = reduce(this.state, {
      type: 'player.timeout',
      actor: this.state.phase.turn,
      at: deadline,
    });
    if (!result.ok) return;
    this.state = result.value.state;
    for (const event of result.value.events)
      if (event.type === 'game.over') this.onGameOver?.(event.winner, this.state.id);
    this.broadcast();
    this.syncTimers();
  }
}
