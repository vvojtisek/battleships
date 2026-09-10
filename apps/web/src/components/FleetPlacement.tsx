import {
  FLEET_SPEC,
  isLegalPlacement,
  makeShip,
  shipLength,
  type Cell,
  type Direction,
  type ShipKind,
} from '@bs/engine';
import { useEffect, useState, type CSSProperties } from 'react';
import { Board } from './Board.js';
import type { PlayerCommand } from '../game/messages.js';
import type { ProjectedRoomState } from '@bs/engine';

interface Props {
  readonly snapshot: ProjectedRoomState;
  readonly send: (command: PlayerCommand) => void;
}

export function FleetPlacement({ snapshot, send }: Props) {
  const [selected, setSelected] = useState<ShipKind>('carrier');
  const [direction, setDirection] = useState<Direction>('H');
  const [previewCell, setPreviewCell] = useState<Cell | null>(null);
  const placed = new Set(snapshot.you.ships.map(({ kind }) => kind));
  const fleet = snapshot.you.ships.reduce(
    (mask, ship) => ship.cells.reduce((value, cell) => value | (1n << BigInt(cell)), mask),
    0n,
  );
  const selectedShip = snapshot.you.ships.find(({ kind }) => kind === selected);
  const occupancyWithoutSelected = selectedShip
    ? fleet & ~selectedShip.cells.reduce((mask, cell) => mask | (1n << BigInt(cell)), 0n)
    : fleet;
  const previewShip = previewCell === null ? null : makeShip(selected, previewCell, direction);
  const previewIsLegal =
    previewShip !== null &&
    previewCell !== null &&
    isLegalPlacement(
      occupancyWithoutSelected,
      shipLength(selected),
      previewCell,
      direction === 'V' ? 1 : 0,
      snapshot.rules,
    );

  useEffect(() => {
    const next = FLEET_SPEC.find(({ kind }) => !placed.has(kind))?.kind;
    if (next) setSelected(next);
  }, [snapshot.you.ships]);

  function place(cell: Cell, kind = selected): void {
    send({ type: 'fleet.place', shipKind: kind, bow: cell, dir: direction });
    setPreviewCell(null);
  }

  return (
    <main className="game-layout">
      <section className="panel controls">
        <h1>Ready your fleet</h1>
        <p>
          {snapshot.you.committed
            ? snapshot.opponent.committed
              ? 'Both fleets are confirmed. Starting battle…'
              : 'Your fleet is confirmed. Waiting for the other player.'
            : 'Drag a ship from the dock or select it, then choose its bow cell. Ships need one clear cell around them, including diagonally.'}
        </p>
        <div aria-label="Ship dock" className="ship-dock">
          {FLEET_SPEC.map((ship) => (
            <button
              aria-pressed={selected === ship.kind}
              className={selected === ship.kind ? 'selected' : ''}
              disabled={snapshot.you.committed}
              draggable
              key={ship.kind}
              onClick={() => setSelected(ship.kind)}
              onDragStart={(event) => {
                setSelected(ship.kind);
                event.dataTransfer.setData('application/x-battleship-kind', ship.kind);
              }}
              type="button"
            >
              <span
                aria-hidden="true"
                className="dock-ship"
                style={{ '--length': ship.length } as CSSProperties}
              />
              <span>
                {ship.kind} <small>{ship.length} cells</small>
              </span>
              <strong>{placed.has(ship.kind) ? 'On board' : 'Ready'}</strong>
            </button>
          ))}
        </div>
        <div className="button-row">
          <button
            disabled={snapshot.you.committed}
            onClick={() => setDirection(direction === 'H' ? 'V' : 'H')}
            type="button"
          >
            Rotate ship ({direction})
          </button>
          <button
            disabled={snapshot.you.committed}
            onClick={() => send({ type: 'fleet.random' })}
            type="button"
          >
            Randomize fleet
          </button>
          <button
            disabled={snapshot.you.committed}
            onClick={() => send({ type: 'fleet.clear' })}
            type="button"
          >
            Return all
          </button>
          <button
            disabled={placed.size !== 5 || snapshot.you.committed}
            onClick={() => send({ type: 'fleet.commit', at: Date.now() })}
            type="button"
          >
            {snapshot.you.committed ? 'Fleet confirmed' : 'Start battle'}
          </button>
        </div>
      </section>
      <div
        onKeyDown={(event) => {
          if (event.key.toLowerCase() === 'r') setDirection(direction === 'H' ? 'V' : 'H');
        }}
      >
        <Board
          label="Your placement board"
          fleet={fleet}
          shots={0n}
          hits={0n}
          disabled={snapshot.you.committed}
          onCell={place}
          onPreviewCell={setPreviewCell}
          onDropShip={(cell, kind) => place(cell, kind as ShipKind)}
          preview={previewShip?.mask ?? 0n}
          previewState={previewIsLegal ? 'valid' : 'invalid'}
        />
      </div>
    </main>
  );
}
