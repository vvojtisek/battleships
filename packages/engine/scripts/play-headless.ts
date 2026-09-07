import {
  cellsOf,
  createRoom,
  has,
  opponentId,
  playerId,
  reduce,
  roomId,
  type Command,
} from '../src/index.js';

const first = playerId('player-one');
const second = playerId('player-two');
let state = createRoom({
  id: roomId('headless-demo'),
  code: 'DEMO01',
  creator: first,
  displayName: 'Player One',
  seed: 20260907,
  now: 0,
});

function dispatch(command: Command): void {
  const result = reduce(state, command);
  if (!result.ok) throw new Error(`${result.code}: ${result.detail}`);
  state = result.value.state;
}

dispatch({ type: 'room.join', actor: second, displayName: 'Player Two', at: 0 });
for (const actor of [first, second]) {
  dispatch({ type: 'fleet.random', actor });
  dispatch({ type: 'fleet.commit', actor, at: 1_000 });
}

while (state.phase.kind === 'in_game') {
  const actor = state.phase.turn;
  const target = opponentId(state, actor);
  if (target === null) throw new Error('missing opponent');
  const targetState = state.players[target];
  if (!targetState) throw new Error('missing target state');
  const cell = cellsOf(targetState.fleet).find(
    (candidate) => !has(targetState.incoming, candidate),
  );
  if (cell === undefined) throw new Error('no target cell');
  dispatch({ type: 'turn.fire', actor, cell, at: state.seq * 1_000 });
}

if (state.phase.kind !== 'game_over') throw new Error('game did not finish');
process.stdout.write(
  `Headless game complete: ${state.phase.winner} won in ${state.log.length} shots.\n`,
);
