/// <reference lib="webworker" />
import {
  FLEET_SPEC,
  STANDARD_RULES,
  createRoom,
  easyAi,
  hardAi,
  makeRng,
  mediumAi,
  playerId,
  projectRoom,
  reduce,
  roomId,
  type AiPlayer,
  type Command,
  type Knowledge,
  type RoomState,
  type ShipKind,
} from '@bs/engine';
import type { Difficulty, WorkerCommand, WorkerEvent } from './messages.js';

const human = playerId('local-human');
const bot = playerId('local-bot');
let state: RoomState | null = null;
let difficulty: Difficulty = 'hard';
let timer: ReturnType<typeof setTimeout> | null = null;

function emit(event: WorkerEvent): void {
  self.postMessage(event);
}

function snapshot(): void {
  if (state) emit({ type: 'game.snapshot', state: projectRoom(state, human, Date.now()) });
}

function dispatch(command: Command): boolean {
  if (!state) return false;
  const result = reduce(state, command);
  if (!result.ok) {
    emit({ type: 'game.error', code: result.code, detail: result.detail });
    return false;
  }
  state = result.value.state;
  snapshot();
  return true;
}

function aiFor(level: Difficulty): AiPlayer {
  return level === 'easy' ? easyAi : level === 'medium' ? mediumAi : hardAi;
}

function botKnowledge(room: RoomState): Knowledge {
  const target = room.players[human]!;
  const sunk = target.ships.filter((ship) => (ship.mask & target.incoming) === ship.mask);
  const sunkKinds = new Set(sunk.map(({ kind }) => kind));
  return {
    shots: target.incoming,
    hits: target.incoming & target.fleet,
    sunkCells: sunk.reduce((mask, ship) => mask | ship.mask, 0n),
    remaining: FLEET_SPEC.map(({ kind }) => kind).filter(
      (kind): kind is ShipKind => !sunkKinds.has(kind),
    ),
    rules: room.rules,
  };
}

function scheduleBot(): void {
  if (!state || state.phase.kind !== 'in_game' || state.phase.turn !== bot) return;
  if (timer) clearTimeout(timer);
  const delayRng = makeRng(state.rngState);
  timer = setTimeout(
    () => {
      if (!state || state.phase.kind !== 'in_game' || state.phase.turn !== bot) return;
      const rng = makeRng(state.rngState);
      const cell = aiFor(difficulty).nextShot(botKnowledge(state), rng);
      state = { ...state, rngState: rng.state() };
      dispatch({ type: 'turn.fire', actor: bot, cell, at: Date.now() });
    },
    400 + delayRng.int(501),
  );
}

function newGame(level: Difficulty): void {
  difficulty = level;
  if (timer) clearTimeout(timer);
  state = createRoom({
    id: roomId('local-room'),
    code: 'LOCAL1',
    creator: human,
    displayName: 'You',
    seed: Date.now(),
    now: Date.now(),
    rules: STANDARD_RULES,
  });
  dispatch({
    type: 'room.join',
    actor: bot,
    displayName: `${level[0]!.toUpperCase()}${level.slice(1)} AI`,
    at: Date.now(),
    isBot: true,
  });
  dispatch({ type: 'fleet.random', actor: bot });
  dispatch({ type: 'fleet.commit', actor: bot, at: Date.now() });
}

self.addEventListener('message', ({ data }: MessageEvent<WorkerCommand>) => {
  if (data.type === 'game.new') {
    newGame(data.difficulty);
    return;
  }
  if (!state) return;
  const command = { ...data.command, actor: human } as Command;
  if (dispatch(command)) scheduleBot();
});
