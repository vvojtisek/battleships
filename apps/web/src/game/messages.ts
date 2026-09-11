import type { Command, ProjectedRoomState } from '@bs/engine';

export type Difficulty = 'easy' | 'medium' | 'hard';
type WithoutActor<T> = T extends unknown ? Omit<T, 'actor'> : never;

export type PlayerCommand = WithoutActor<
  Exclude<Command, { readonly type: 'player.connection' | 'player.timeout' }>
>;

export type WorkerCommand =
  | { readonly type: 'game.new'; readonly difficulty: Difficulty }
  | { readonly type: 'game.command'; readonly command: PlayerCommand };

export type WorkerEvent =
  | { readonly type: 'game.snapshot'; readonly state: ProjectedRoomState }
  | { readonly type: 'game.error'; readonly code: string; readonly detail: string };
