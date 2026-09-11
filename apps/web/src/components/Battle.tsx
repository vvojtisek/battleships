import {
  FLEET_SPEC,
  label as cellLabel,
  popcount,
  type Cell,
  type ProjectedRoomState,
} from '@bs/engine';
import { useEffect, useState } from 'react';
import { Board } from './Board.js';
import { useBattleSounds } from '../game/battleSounds.js';
import type { PlayerCommand } from '../game/messages.js';
import type { Difficulty } from '../game/messages.js';

interface Props {
  readonly snapshot: ProjectedRoomState;
  readonly send: (command: PlayerCommand) => void;
  readonly onNewGame: () => void;
  readonly difficulty?: Difficulty;
  readonly playerPoints?: number;
  readonly opponentName?: string;
  readonly newGameLabel?: string;
  readonly onChooseDifficulty?: () => void;
  readonly onRematch?: () => void;
  readonly onLeaderboard: () => void;
  readonly onMainMenu: () => void;
}

const SOUND_KEY = 'battleships.sound-effects.v1';
const CONFIRM_SHOTS_KEY = 'battleships.confirm-touch-shots.v1';

function loadSoundPreference(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) !== 'off';
  } catch {
    return true;
  }
}

function loadConfirmShotsPreference(): boolean {
  try {
    return localStorage.getItem(CONFIRM_SHOTS_KEY) !== 'off';
  } catch {
    return true;
  }
}

function shipName(kind: string): string {
  return `${kind[0]!.toUpperCase()}${kind.slice(1)}`;
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
  playerPoints,
  opponentName = 'Computer',
  newGameLabel = 'Play again',
  onChooseDifficulty,
  onRematch,
  onLeaderboard,
  onMainMenu,
}: Props) {
  const compact = useCompactBattleLayout();
  const [boardView, setBoardView] = useState<'enemy' | 'fleet'>('enemy');
  const [target, setTarget] = useState<Cell | null>(null);
  const [soundsEnabled, setSoundsEnabled] = useState(loadSoundPreference);
  const [confirmShots, setConfirmShots] = useState(loadConfirmShotsPreference);
  const [now, setNow] = useState(Date.now());
  const ownFleet = snapshot.you.ships.reduce(
    (mask, ship) => ship.cells.reduce((value, cell) => value | (1n << BigInt(cell)), mask),
    0n,
  );
  const ownIncoming = BigInt(`0x${snapshot.you.incoming}`);
  const opponentShots = BigInt(`0x${snapshot.opponent.shotsFired}`);
  const opponentHits = BigInt(`0x${snapshot.opponent.shotsHit}`);
  const gameOver = snapshot.phase.kind === 'game_over';
  const yourTurn = snapshot.phase.kind === 'in_game' && snapshot.phase.turn === snapshot.you.id;
  const opponentDisconnected = Boolean(snapshot.opponent.id && !snapshot.opponent.online);
  const shots = popcount(opponentShots);
  const hits = popcount(opponentHits);
  const accuracy = shots === 0 ? 0 : Math.round((hits / shots) * 100);
  const turns = shots + popcount(ownIncoming);
  const shipsRemaining = 5 - snapshot.opponent.sunk.length;
  const latestShot = snapshot.latestShot;
  const latestShotByYou = latestShot?.by === snapshot.you.id;
  const turnSeconds =
    snapshot.phase.kind === 'in_game'
      ? Math.max(0, Math.ceil((snapshot.phase.turnDeadline - now) / 1_000))
      : null;

  useBattleSounds(snapshot, soundsEnabled);

  useEffect(() => {
    if (!compact || !yourTurn || gameOver) setTarget(null);
  }, [compact, gameOver, yourTurn]);

  useEffect(() => {
    if (snapshot.phase.kind !== 'in_game') return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [snapshot.phase.kind, snapshot.phase.kind === 'in_game' ? snapshot.phase.turnDeadline : 0]);

  function fire(cell: Cell): void {
    send({ type: 'turn.fire', cell, at: Date.now() });
  }

  function aimOrFire(cell: Cell): void {
    if (compact && confirmShots) {
      setBoardView('enemy');
      setTarget(cell);
      return;
    }
    fire(cell);
  }

  function toggleShotConfirmation(): void {
    setConfirmShots((current) => {
      const next = !current;
      try {
        localStorage.setItem(CONFIRM_SHOTS_KEY, next ? 'on' : 'off');
      } catch {
        // Touch confirmation remains usable when browser storage is unavailable.
      }
      return next;
    });
  }

  function latestAction(): string | null {
    if (!latestShot) return null;
    const actor = latestShotByYou ? 'You' : opponentName;
    const result =
      latestShot.outcome === 'sunk'
        ? `sank ${latestShotByYou ? 'an enemy' : 'your'} ${shipName(latestShot.shipKind ?? 'ship')}`
        : latestShot.outcome;
    return `${actor} fired at ${cellLabel(latestShot.cell)} — ${result}.`;
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
              : opponentDisconnected
                ? `${opponentName} is reconnecting…`
                : yourTurn
                  ? 'Your turn'
                  : `${opponentName} is thinking…`}
          </h1>
          <p>
            {gameOver
              ? `${snapshot.opponent.sunk.length} enemy ships sunk. ${
                  snapshot.phase.reason === 'forfeit' ? 'The match ended by surrender.' : ''
                }`
              : opponentDisconnected
                ? 'The match is paused for up to two minutes while the player reconnects.'
                : snapshot.phase.kind === 'in_game' &&
                    snapshot.phase.turnNo === 1 &&
                    latestShot === undefined
                  ? `${yourTurn ? 'You fire first.' : `${opponentName} fires first.`} One shot per turn.`
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
        </div>
      </header>
      {difficulty && (
        <p className="match-context">
          Opponent: {opponentName} · {shipName(difficulty)} AI
        </p>
      )}
      {turnSeconds !== null && !gameOver && !opponentDisconnected && (
        <p aria-live="polite" className="turn-timer">
          Turn timer: {turnSeconds}s
        </p>
      )}
      {latestAction() && (
        <p aria-live="polite" className="recent-action">
          {latestAction()}
        </p>
      )}
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
        {difficulty && playerPoints !== undefined && (
          <div>
            <span>Career points</span>
            <strong>{playerPoints}</strong>
          </div>
        )}
      </section>
      <section aria-label="Enemy fleet status" className="fleet-status">
        <h2>Enemy fleet status</h2>
        <ul>
          {FLEET_SPEC.map((ship) => (
            <li key={ship.kind}>
              <span>{shipName(ship.kind)}</span>
              <strong>{snapshot.opponent.sunk.includes(ship.kind) ? 'Sunk' : 'Afloat'}</strong>
            </li>
          ))}
        </ul>
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
              className={
                !latestShotByYou && latestShot?.outcome !== 'miss'
                  ? 'fleet-under-attack'
                  : undefined
              }
              onClick={() => setBoardView('fleet')}
              type="button"
            >
              Your fleet
            </button>
          </div>
          {yourTurn && !gameOver && !opponentDisconnected && (
            <div className="touch-shot-options">
              <p className="touch-shot-hint">
                {confirmShots ? 'Tap a square, then confirm your shot.' : 'Tap a square to fire.'}
              </p>
              <label>
                <input checked={confirmShots} onChange={toggleShotConfirmation} type="checkbox" />
                Confirm each touch shot
              </label>
            </div>
          )}
        </>
      )}
      {compact &&
        confirmShots &&
        target !== null &&
        yourTurn &&
        !gameOver &&
        !opponentDisconnected && (
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
            fleet={
              gameOver && snapshot.opponent.id
                ? (snapshot.reveal?.[snapshot.opponent.id]?.reduce(
                    (mask, ship) =>
                      ship.cells.reduce((value, cell) => value | (1n << BigInt(cell)), mask),
                    0n,
                  ) ?? 0n)
                : 0n
            }
            shots={opponentShots}
            hits={opponentHits}
            disabled={!yourTurn || gameOver || opponentDisconnected}
            onCell={aimOrFire}
            selectedCell={target}
          />
        </div>
      </div>
      {gameOver && (
        <div
          aria-modal="true"
          className="game-over-backdrop"
          role="dialog"
          aria-labelledby="game-over-title"
        >
          <section className="game-over-panel">
            <p className="eyebrow">Match complete</p>
            <h2 id="game-over-title">
              {snapshot.phase.winner === snapshot.you.id ? 'You won' : `${opponentName} won`}
            </h2>
            <p>
              {snapshot.phase.reason === 'sunk_all'
                ? 'Every ship in the losing fleet was sunk.'
                : snapshot.phase.reason === 'forfeit'
                  ? 'The match ended by surrender.'
                  : 'The active player ran out of time.'}
            </p>
            <p className="game-over-reason">
              Reason: <strong>{snapshot.phase.reason}</strong>
            </p>
            <dl className="game-over-stats">
              <div>
                <dt>Shots</dt>
                <dd>{shots}</dd>
              </div>
              <div>
                <dt>Hits</dt>
                <dd>{hits}</dd>
              </div>
              <div>
                <dt>Accuracy</dt>
                <dd>{accuracy}%</dd>
              </div>
              <div>
                <dt>Turns</dt>
                <dd>{turns}</dd>
              </div>
            </dl>
            <div className="button-row">
              <button
                className="primary-button"
                disabled={Boolean(onRematch && snapshot.you.rematch)}
                onClick={onRematch ?? onNewGame}
                type="button"
              >
                {onRematch
                  ? snapshot.you.rematch
                    ? 'Rematch requested'
                    : snapshot.opponent.rematch
                      ? 'Accept rematch'
                      : 'Play again'
                  : newGameLabel}
              </button>
              <button onClick={onChooseDifficulty ?? onMainMenu} type="button">
                Choose difficulty
              </button>
              <button onClick={onLeaderboard} type="button">
                Leaderboard
              </button>
              <button onClick={onMainMenu} type="button">
                Main menu
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
