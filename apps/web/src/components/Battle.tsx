import { label as cellLabel, popcount, type Cell, type ProjectedRoomState } from '@bs/engine';
import { useEffect, useState } from 'react';
import { Board } from './Board.js';
import { useBattleSounds } from '../game/battleSounds.js';
import type { PlayerCommand } from '../game/messages.js';
import type { Difficulty } from '../game/messages.js';
import type { Score } from '../game/scores.js';

interface Props {
  readonly snapshot: ProjectedRoomState;
  readonly send: (command: PlayerCommand) => void;
  readonly onNewGame: () => void;
  readonly difficulty?: Difficulty;
  readonly score?: Score;
  readonly opponentName?: string;
  readonly newGameLabel?: string;
}

const SOUND_KEY = 'battleships.sound-effects.v1';

function loadSoundPreference(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) !== 'off';
  } catch {
    return true;
  }
}

function useCompactBattleLayout(): boolean {
  const query = '(max-width: 1023px)';
  const [compact, setCompact] = useState(() => window.matchMedia(query).matches);

  useEffect(() => {
    const mediaQuery = window.matchMedia(query);
    const updateLayout = (): void => setCompact(mediaQuery.matches);
    updateLayout();
    mediaQuery.addEventListener('change', updateLayout);
    return () => mediaQuery.removeEventListener('change', updateLayout);
  }, []);

  return compact;
}

export function Battle({
  snapshot,
  send,
  onNewGame,
  difficulty,
  score,
  opponentName = 'Computer',
  newGameLabel = 'Play again',
}: Props) {
  const compact = useCompactBattleLayout();
  const [boardView, setBoardView] = useState<'enemy' | 'fleet'>('enemy');
  const [target, setTarget] = useState<Cell | null>(null);
  const [soundsEnabled, setSoundsEnabled] = useState(loadSoundPreference);
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

  useBattleSounds(snapshot, soundsEnabled);

  useEffect(() => {
    if (!compact || !yourTurn || gameOver) setTarget(null);
  }, [compact, gameOver, yourTurn]);

  function fire(cell: Cell): void {
    send({ type: 'turn.fire', cell, at: Date.now() });
  }

  function aimOrFire(cell: Cell): void {
    if (compact) {
      setBoardView('enemy');
      setTarget(cell);
      return;
    }
    fire(cell);
  }

  function confirmTarget(): void {
    if (target === null) return;
    fire(target);
    setTarget(null);
  }

  function toggleSounds(): void {
    setSoundsEnabled((current) => {
      const next = !current;
      try {
        localStorage.setItem(SOUND_KEY, next ? 'on' : 'off');
      } catch {
        // Sound preference is optional when browser storage is unavailable.
      }
      return next;
    });
  }

  return (
    <main>
      <header className="battle-header">
        <div>
          <h1 aria-live="polite">
            {gameOver
              ? snapshot.phase.winner === snapshot.you.id
                ? 'You won'
                : `${opponentName} won`
              : yourTurn
                ? 'Your turn'
                : `${opponentName} is thinking…`}
          </h1>
          <p>
            {gameOver
              ? `${snapshot.opponent.sunk.length} enemy ships sunk.`
              : 'One shot per turn. Hits do not grant an extra shot.'}
          </p>
        </div>
        <div className="battle-actions">
          <button
            aria-pressed={soundsEnabled}
            className="sound-toggle"
            onClick={toggleSounds}
            type="button"
          >
            Sound {soundsEnabled ? 'on' : 'off'}
          </button>
          {gameOver && (
            <button onClick={onNewGame} type="button">
              {newGameLabel}
            </button>
          )}
        </div>
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
        {difficulty && score && (
          <div>
            <span>{difficulty} record</span>
            <strong>
              {score.wins}–{score.losses}
            </strong>
          </div>
        )}
      </section>
      {compact && (
        <>
          <div aria-label="Choose board" className="board-switch" role="group">
            <button
              aria-pressed={boardView === 'enemy'}
              onClick={() => setBoardView('enemy')}
              type="button"
            >
              Enemy waters
            </button>
            <button
              aria-pressed={boardView === 'fleet'}
              onClick={() => setBoardView('fleet')}
              type="button"
            >
              Your fleet
            </button>
          </div>
          {yourTurn && !gameOver && (
            <p className="touch-shot-hint">Tap a square, then confirm your shot.</p>
          )}
        </>
      )}
      {compact && target !== null && yourTurn && !gameOver && (
        <section aria-live="polite" className="shot-confirmation">
          <p>
            Target selected: <strong>{cellLabel(target)}</strong>
          </p>
          <div>
            <button className="fire-target" onClick={confirmTarget} type="button">
              Fire at {cellLabel(target)}
            </button>
            <button onClick={() => setTarget(null)} type="button">
              Choose again
            </button>
          </div>
        </section>
      )}
      <div className={`boards${compact ? ` compact-${boardView}` : ''}`}>
        <div className="fleet-board">
          <h2>Your fleet</h2>
          <Board
            label="Your fleet board"
            fleet={ownFleet}
            shots={ownIncoming}
            hits={ownIncoming & ownFleet}
            disabled
          />
        </div>
        <div className="enemy-board">
          <h2>Enemy waters</h2>
          <Board
            label="Enemy waters board"
            shots={opponentShots}
            hits={opponentHits}
            disabled={!yourTurn || gameOver}
            onCell={aimOrFire}
            selectedCell={target}
          />
        </div>
      </div>
    </main>
  );
}
