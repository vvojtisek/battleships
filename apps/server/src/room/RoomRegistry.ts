import { randomBytes, randomUUID } from 'node:crypto';
import { createRoom, playerId, roomId, type PlayerId } from '@bs/engine';
import { RoomActor } from './RoomActor.js';

const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export interface CreatedRoom {
  readonly code: string;
  readonly playerId: PlayerId;
  readonly resumeToken: string;
}

export interface ResumedPlayer {
  readonly actor: RoomActor;
  readonly playerId: PlayerId;
  readonly code: string;
}

export interface JoinableRoom {
  readonly code: string;
  readonly creatorName: string;
  readonly createdAt: number;
}

interface RegisteredRoom {
  readonly actor: RoomActor;
  readonly creator: PlayerId;
  readonly creatorName: string;
  readonly createdAt: number;
  readonly tokens: Map<string, { readonly playerId: PlayerId; readonly expiresAt: number }>;
  readonly profiles: Map<PlayerId, string | undefined>;
}

const LOBBY_TTL_MS = 10 * 60 * 1_000;
const LOBBY_DISCONNECT_GRACE_MS = 60 * 1_000;

type WinnerHandler = (code: string, winner: PlayerId, matchId: string) => void;

/** In-memory room directory. Redis ownership/snapshots are the next deployment slice. */
export class RoomRegistry {
  private readonly rooms = new Map<string, RegisteredRoom>();
  private readonly lobbyCloseTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private winnerHandler: WinnerHandler | undefined;

  public constructor(private readonly now: () => number = Date.now) {}

  public create(displayName: string, profileUsername?: string, now = this.now()): CreatedRoom {
    const code = this.nextCode();
    const creator = playerId(randomUUID());
    const token = this.token();
    const actor = new RoomActor(
      createRoom({
        id: roomId(randomUUID()),
        code,
        creator,
        displayName,
        seed: randomBytes(4).readUInt32BE(),
        now,
      }),
      this.now,
      (winner, matchId) => this.winnerHandler?.(code, winner, matchId),
    );
    this.rooms.set(code, {
      actor,
      creator,
      creatorName: displayName,
      createdAt: now,
      tokens: new Map([[token, this.tokenRecord(creator)]]),
      profiles: new Map([[creator, profileUsername]]),
    });
    return { code, playerId: creator, resumeToken: token };
  }

  public find(code: string): RoomActor | undefined {
    this.prune();
    return this.rooms.get(code)?.actor;
  }

  public listJoinable(): readonly JoinableRoom[] {
    this.prune();
    return Array.from(this.rooms, ([code, room]) => ({ code, room }))
      .filter(({ room }) => room.actor.isJoinable())
      .map(({ code, room }) => ({
        code,
        creatorName: room.creatorName,
        createdAt: room.createdAt,
      }));
  }

  public resume(token: string): ResumedPlayer | undefined {
    this.prune();
    for (const [code, room] of this.rooms) {
      const record = room.tokens.get(token);
      if (!record) continue;
      if (record.expiresAt <= this.now()) {
        room.tokens.delete(token);
        continue;
      }
      return { actor: room.actor, playerId: record.playerId, code };
    }
    return undefined;
  }

  public issueToken(code: string, player: PlayerId): string | undefined {
    const room = this.rooms.get(code);
    if (!room) return undefined;
    const token = this.token();
    room.tokens.set(token, this.tokenRecord(player));
    return token;
  }

  public setProfile(code: string, player: PlayerId, username: string | undefined): void {
    this.rooms.get(code)?.profiles.set(player, username);
  }

  public profileFor(code: string, player: PlayerId): string | undefined {
    return this.rooms.get(code)?.profiles.get(player);
  }

  public opponentProfileFor(code: string, player: PlayerId): string | undefined {
    const room = this.rooms.get(code);
    if (!room) return undefined;
    for (const [candidate, profile] of room.profiles) if (candidate !== player) return profile;
    return undefined;
  }

  /** Closes an unstarted room only when its creator presents the opaque resume token. */
  public closeLobby(code: string, token: string): boolean {
    const room = this.rooms.get(code);
    const record = room?.tokens.get(token);
    if (!record || record.playerId !== room?.creator || !room.actor.isJoinable()) return false;
    this.deleteRoom(code);
    return true;
  }

  /** A waiting room gets one minute for a refresh/reconnect before it disappears from the list. */
  public playerDisconnected(code: string, player: PlayerId): void {
    const room = this.rooms.get(code);
    if (room?.creator !== player || !room.actor.isJoinable()) return;
    this.clearLobbyCloseTimer(code);
    const timer = setTimeout(() => {
      if (this.rooms.get(code)?.actor.isJoinable()) this.deleteRoom(code);
    }, LOBBY_DISCONNECT_GRACE_MS);
    timer.unref();
    this.lobbyCloseTimers.set(code, timer);
  }

  public playerConnected(code: string, player: PlayerId): void {
    const room = this.rooms.get(code);
    if (room?.creator === player) this.clearLobbyCloseTimer(code);
  }

  public setWinnerHandler(handler: WinnerHandler): void {
    this.winnerHandler = handler;
  }

  private nextCode(): string {
    for (;;) {
      const code = Array.from(randomBytes(6), (byte) => alphabet[byte % alphabet.length]).join('');
      if (!this.rooms.has(code)) return code;
    }
  }

  private token(): string {
    return randomBytes(32).toString('base64url');
  }

  private tokenRecord(playerId: PlayerId): {
    readonly playerId: PlayerId;
    readonly expiresAt: number;
  } {
    return { playerId, expiresAt: this.now() + 10 * 60 * 1000 };
  }

  private prune(): void {
    const now = this.now();
    for (const [code, room] of this.rooms) {
      if (room.actor.isJoinable() && now - room.createdAt >= LOBBY_TTL_MS) this.deleteRoom(code);
    }
  }

  private deleteRoom(code: string): void {
    this.clearLobbyCloseTimer(code);
    this.rooms.delete(code);
  }

  private clearLobbyCloseTimer(code: string): void {
    const timer = this.lobbyCloseTimers.get(code);
    if (timer) clearTimeout(timer);
    this.lobbyCloseTimers.delete(code);
  }
}
