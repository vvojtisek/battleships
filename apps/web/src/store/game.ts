import type { ProjectedRoomState } from '@bs/engine';
import { create } from 'zustand';
import type { Difficulty, WorkerCommand } from '../game/messages.js';

interface GameStore {
  readonly snapshot: ProjectedRoomState | null;
  readonly difficulty: Difficulty;
  readonly error: string | null;
  setDifficulty(difficulty: Difficulty): void;
  receive(snapshot: ProjectedRoomState): void;
  clearSnapshot(): void;
  fail(message: string): void;
  clearError(): void;
  send: ((command: WorkerCommand) => void) | null;
  connect(send: (command: WorkerCommand) => void): void;
}

export const useGame = create<GameStore>((set) => ({
  snapshot: null,
  difficulty: 'hard',
  error: null,
  send: null,
  setDifficulty: (difficulty) => set({ difficulty }),
  receive: (snapshot) => set({ snapshot, error: null }),
  clearSnapshot: () => set({ snapshot: null, error: null }),
  fail: (error) => set({ error }),
  clearError: () => set({ error: null }),
  connect: (send) => set({ send }),
}));
