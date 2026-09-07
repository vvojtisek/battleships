import { EMPTY, type Board } from './board.js';
import type { Cell } from './coords.js';
import type { RuleSet, Ship, ShipKind } from './ships.js';
import { STANDARD_RULES } from './ships.js';

declare const playerIdBrand: unique symbol;
declare const roomIdBrand: unique symbol;
export type PlayerId = string & { readonly [playerIdBrand]: true };
export type RoomId = string & { readonly [roomIdBrand]: true };

export const playerId = (value: string): PlayerId => value as PlayerId;
export const roomId = (value: string): RoomId => value as RoomId;

export type Phase =
  | { readonly kind: 'lobby' }
  | { readonly kind: 'placing'; readonly deadline: number }
  | { readonly kind: 'ready' }
  | {
      readonly kind: 'in_game';
      readonly turn: PlayerId;
      readonly turnDeadline: number;
      readonly turnNo: number;
    }
  | {
      readonly kind: 'game_over';
      readonly winner: PlayerId;
      readonly reason: 'sunk_all' | 'forfeit' | 'timeout';
    }
  | { readonly kind: 'closed'; readonly reason: string };

export interface PlayerState {
  readonly id: PlayerId;
  readonly displayName: string;
  readonly ships: readonly Ship[];
  readonly fleet: Board;
  readonly incoming: Board;
  readonly committed: boolean;
  readonly online: boolean;
  readonly graceEndsAt: number | null;
  readonly timeouts: number;
  readonly isBot: boolean;
  readonly rematch: boolean;
}

export interface ShotRecord {
  readonly seq: number;
  readonly by: PlayerId;
  readonly cell: Cell;
  readonly outcome: 'miss' | 'hit' | 'sunk';
  readonly shipKind?: ShipKind;
  readonly at: number;
}

export interface RoomState {
  readonly id: RoomId;
  readonly code: string;
  readonly rules: RuleSet;
  readonly phase: Phase;
  readonly players: Readonly<Record<PlayerId, PlayerState>>;
  readonly order: readonly [PlayerId, PlayerId] | readonly [PlayerId];
  readonly seq: number;
  readonly rngState: number;
  readonly createdAt: number;
  readonly log: readonly ShotRecord[];
  readonly firstTurnIndex: 0 | 1;
}

export interface CreateRoomOptions {
  readonly id: RoomId;
  readonly code: string;
  readonly creator: PlayerId;
  readonly displayName: string;
  readonly seed: number;
  readonly now: number;
  readonly rules?: RuleSet;
  readonly creatorIsBot?: boolean;
}

export function emptyPlayer(id: PlayerId, displayName: string, isBot = false): PlayerState {
  return {
    id,
    displayName,
    ships: [],
    fleet: EMPTY,
    incoming: EMPTY,
    committed: false,
    online: true,
    graceEndsAt: null,
    timeouts: 0,
    isBot,
    rematch: false,
  };
}

export function createRoom(options: CreateRoomOptions): RoomState {
  const creator = emptyPlayer(options.creator, options.displayName, options.creatorIsBot ?? false);
  return {
    id: options.id,
    code: options.code,
    rules: options.rules ?? STANDARD_RULES,
    phase: { kind: 'lobby' },
    players: { [options.creator]: creator },
    order: [options.creator],
    seq: 0,
    rngState: options.seed >>> 0,
    createdAt: options.now,
    log: [],
    firstTurnIndex: 0,
  };
}

export function opponentId(state: RoomState, actor: PlayerId): PlayerId | null {
  if (state.order.length !== 2) return null;
  if (state.order[0] === actor) return state.order[1];
  if (state.order[1] === actor) return state.order[0];
  return null;
}

export function opponentOf(state: RoomState, actor: PlayerId): PlayerState | null {
  const id = opponentId(state, actor);
  if (id === null) return null;
  /* v8 ignore next */
  return state.players[id] ?? null;
}
