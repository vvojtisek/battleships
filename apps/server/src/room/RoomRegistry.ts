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

interface RegisteredRoom {
  readonly actor: RoomActor;
  readonly tokens: Map<string, PlayerId>;
}

/** In-memory room directory. Redis ownership/snapshots are the next deployment slice. */
export class RoomRegistry {
  private readonly rooms = new Map<string, RegisteredRoom>();

  public create(displayName: string, now = Date.now()): CreatedRoom {
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
    );
    this.rooms.set(code, { actor, tokens: new Map([[token, creator]]) });
    return { code, playerId: creator, resumeToken: token };
  }

  public find(code: string): RoomActor | undefined {
    return this.rooms.get(code)?.actor;
  }

  public resume(token: string): ResumedPlayer | undefined {
    for (const [code, room] of this.rooms) {
      const player = room.tokens.get(token);
      if (player) return { actor: room.actor, playerId: player, code };
    }
    return undefined;
  }

  public issueToken(code: string, player: PlayerId): string | undefined {
    const room = this.rooms.get(code);
    if (!room) return undefined;
    const token = this.token();
    room.tokens.set(token, player);
    return token;
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
}
