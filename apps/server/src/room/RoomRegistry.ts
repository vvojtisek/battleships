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
}

interface RegisteredRoom {
  readonly actor: RoomActor;
  readonly creatorName: string;
  readonly tokens: Map<string, { readonly playerId: PlayerId; readonly expiresAt: number }>;
  readonly profiles: Map<PlayerId, string | undefined>;
}

type WinnerHandler = (code: string, winner: PlayerId) => void;

/** In-memory room directory. Redis ownership/snapshots are the next deployment slice. */
export class RoomRegistry {
  private readonly rooms = new Map<string, RegisteredRoom>();
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
      (winner) => this.winnerHandler?.(code, winner),
    );
    this.rooms.set(code, {
      actor,
      creatorName: displayName,
      tokens: new Map([[token, this.tokenRecord(creator)]]),
      profiles: new Map([[creator, profileUsername]]),
    });
    return { code, playerId: creator, resumeToken: token };
  }

  public find(code: string): RoomActor | undefined {
    return this.rooms.get(code)?.actor;
  }

  public listJoinable(): readonly JoinableRoom[] {
    return Array.from(this.rooms, ([code, room]) => ({ code, room }))
      .filter(({ room }) => room.actor.isJoinable())
      .map(({ code, room }) => ({ code, creatorName: room.creatorName }));
  }

  public resume(token: string): ResumedPlayer | undefined {
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
}
