import { popcount, type Cell, type ProjectedRoomState } from '@bs/engine';
import { Board } from './Board.js';
import type { WorkerCommand } from '../game/messages.js';
import type { Difficulty } from '../game/messages.js';
import type { Score } from '../game/scores.js';

interface Props {
  readonly snapshot: ProjectedRoomState;
  readonly send: (command: WorkerCommand) => void;
  readonly onNewGame: () => void;
  readonly difficulty: Difficulty;
  readonly score: Score;
}

export function Battle({ snapshot, send, onNewGame, difficulty, score }: Props) {
  const ownFleet = snapshot.you.ships.reduce(
    (mask, ship) => ship.cells.reduce((value, cell) => value | (1n << BigInt(cell)), mask),
    0n,
  );
  const ownIncoming = BigInt(`0x${snapshot.you.incoming}`);
  const opponentShots = BigInt(`0x${snapshot.opponent.shotsFired}`);
  const opponentHits = BigInt(`0x${snapshot.opponent.shotsHit}`);
  const gameOver = snapshot.phase.kind === 'game_over';
  const yourTurn = snapshot.phase.kind === 'in_game' && snapshot.phase.turn === snapshot.you.id;
  const shots = popcount(opponentShots);
  const hits = popcount(opponentHits);
  const accuracy = shots === 0 ? 0 : Math.round((hits / shots) * 100);
  const shipsRemaining = 5 - snapshot.opponent.sunk.length;

  function fire(cell: Cell): void {
    send({ type: 'game.command', command: { type: 'turn.fire', cell, at: Date.now() } });
  }

  return (
    <main>
      <header className="battle-header">
        <div>
          <h1 aria-live="polite">
            {gameOver
              ? snapshot.phase.winner === snapshot.you.id
                ? 'You won'
                : 'Computer won'
              : yourTurn
                ? 'Your turn'
                : 'Computer is thinking…'}
          </h1>
          <p>
            {gameOver
              ? `${snapshot.opponent.sunk.length} enemy ships sunk.`
              : 'One shot per turn. Hits do not grant an extra shot.'}
          </p>
        </div>
        {gameOver && (
          <button onClick={onNewGame} type="button">
            Play again
          </button>
        )}
      </header>
      <section aria-label="Battle statistics" className="battle-stats">
        <div>
          <span>Shots</span>
          <strong>{shots}</strong>
        </div>
        <div>
          <span>Hits</span>
          <strong>{hits}</strong>
        </div>
        <div>
          <span>Accuracy</span>
          <strong>{accuracy}%</strong>
        </div>
        <div>
          <span>Enemy ships</span>
          <strong>{shipsRemaining}</strong>
        </div>
        <div>
          <span>{difficulty} record</span>
          <strong>
            {score.wins}–{score.losses}
          </strong>
        </div>
      </section>
      <div className="boards">
        <div>
          <h2>Your fleet</h2>
          <Board
            label="Your fleet board"
            fleet={ownFleet}
            shots={ownIncoming}
            hits={ownIncoming & ownFleet}
            disabled
          />
        </div>
        <div>
          <h2>Enemy waters</h2>
          <Board
            label="Enemy waters board"
            shots={opponentShots}
            hits={opponentHits}
            disabled={!yourTurn || gameOver}
            onCell={fire}
          />
        </div>
      </div>
    </main>
  );
}
