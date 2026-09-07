import type { Cell, ProjectedRoomState } from '@bs/engine';
import { Board } from './Board.js';
import type { WorkerCommand } from '../game/messages.js';

interface Props {
  readonly snapshot: ProjectedRoomState;
  readonly send: (command: WorkerCommand) => void;
  readonly onNewGame: () => void;
}

export function Battle({ snapshot, send, onNewGame }: Props) {
  const ownFleet = snapshot.you.ships.reduce(
    (mask, ship) => ship.cells.reduce((value, cell) => value | (1n << BigInt(cell)), mask),
    0n,
  );
  const ownIncoming = BigInt(`0x${snapshot.you.incoming}`);
  const opponentShots = BigInt(`0x${snapshot.opponent.shotsFired}`);
  const opponentHits = BigInt(`0x${snapshot.opponent.shotsHit}`);
  const gameOver = snapshot.phase.kind === 'game_over';
  const yourTurn = snapshot.phase.kind === 'in_game' && snapshot.phase.turn === snapshot.you.id;

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
