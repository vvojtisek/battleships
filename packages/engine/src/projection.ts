import { cellsOf, hex } from './board.js';
import type { RuleSet, ShipKind } from './ships.js';
import type { ShotRecord } from './state.js';
import { opponentOf, type Phase, type PlayerId, type RoomState } from './state.js';

export interface OwnShip {
  readonly id: ShipKind;
  readonly kind: ShipKind;
  readonly length: number;
  readonly bow: number;
  readonly dir: 'H' | 'V';
  readonly cells: readonly number[];
}

export interface ProjectedRoomState {
  readonly matchId: string;
  readonly code: string;
  readonly rules: RuleSet;
  readonly phase: Phase;
  readonly you: {
    readonly id: PlayerId;
    readonly displayName: string;
    readonly ships: readonly OwnShip[];
    readonly incoming: string;
    readonly committed: boolean;
    readonly rematch: boolean;
  };
  readonly opponent: {
    readonly id: PlayerId | null;
    readonly displayName: string | null;
    readonly online: boolean;
    readonly committed: boolean;
    readonly shotsFired: string;
    readonly shotsHit: string;
    readonly sunk: readonly ShipKind[];
    readonly rematch: boolean;
  };
  readonly seq: number;
  readonly serverTime: number;
  readonly latestShot?: ShotRecord;
  readonly reveal?: Readonly<Record<PlayerId, readonly OwnShip[]>>;
}

const toOwnShip = (ship: RoomState['players'][PlayerId]['ships'][number]): OwnShip => ({
  id: ship.id,
  kind: ship.kind,
  length: ship.length,
  bow: ship.bow,
  dir: ship.dir,
  cells: cellsOf(ship.mask),
});

export function projectRoom(
  state: RoomState,
  viewer: PlayerId,
  serverTime: number,
): ProjectedRoomState {
  const me = state.players[viewer];
  if (!me) throw new Error('viewer is not in this room');
  const other = opponentOf(state, viewer);
  const opponent = other
    ? {
        id: other.id,
        displayName: other.displayName,
        online: other.online,
        committed: other.committed,
        shotsFired: hex(other.incoming),
        shotsHit: hex(other.incoming & other.fleet),
        sunk: other.ships
          .filter((ship) => (ship.mask & other.incoming) === ship.mask)
          .map(({ kind }) => kind),
        rematch: other.rematch,
      }
    : {
        id: null,
        displayName: null,
        online: false,
        committed: false,
        shotsFired: '0',
        shotsHit: '0',
        sunk: [],
        rematch: false,
      };
  const base: ProjectedRoomState = {
    matchId: state.id,
    code: state.code,
    rules: state.rules,
    phase: state.phase,
    you: {
      id: me.id,
      displayName: me.displayName,
      ships: me.ships.map(toOwnShip),
      incoming: hex(me.incoming),
      committed: me.committed,
      rematch: me.rematch,
    },
    opponent,
    seq: state.seq,
    serverTime,
    ...(state.log.length > 0 ? { latestShot: state.log[state.log.length - 1]! } : {}),
  };
  if (state.phase.kind !== 'game_over') return base;
  const reveal = Object.fromEntries(
    state.order.map((id) => [id, state.players[id]!.ships.map(toOwnShip)]),
  ) as Record<PlayerId, readonly OwnShip[]>;
  return { ...base, reveal };
}
