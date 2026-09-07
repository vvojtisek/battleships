import { FLEET_SPEC, type Cell, type Direction, type ShipKind } from '@bs/engine';
import { useState } from 'react';
import { Board } from './Board.js';
import type { WorkerCommand } from '../game/messages.js';
import type { ProjectedRoomState } from '@bs/engine';

interface Props {
  readonly snapshot: ProjectedRoomState;
  readonly send: (command: WorkerCommand) => void;
}

export function FleetPlacement({ snapshot, send }: Props) {
  const [selected, setSelected] = useState<ShipKind>('carrier');
  const [direction, setDirection] = useState<Direction>('H');
  const placed = new Set(snapshot.you.ships.map(({ kind }) => kind));
  const fleet = snapshot.you.ships.reduce(
    (mask, ship) => ship.cells.reduce((value, cell) => value | (1n << BigInt(cell)), mask),
    0n,
  );

  function place(cell: Cell, kind = selected): void {
    send({
      type: 'game.command',
      command: { type: 'fleet.place', shipKind: kind, bow: cell, dir: direction },
    });
  }

  return (
    <main className="game-layout">
      <section className="panel controls">
        <h1>Place your fleet</h1>
        <p>
          Select or drag a ship, then choose its bow cell. Arrow keys move across the board; Enter
          places. Press R to rotate.
        </p>
        <div className="fleet-list">
          {FLEET_SPEC.map((ship) => (
            <button
              aria-pressed={selected === ship.kind}
              className={selected === ship.kind ? 'selected' : ''}
              draggable
              key={ship.kind}
              onClick={() => setSelected(ship.kind)}
              onDragStart={(event) =>
                event.dataTransfer.setData('application/x-battleship-kind', ship.kind)
              }
              type="button"
            >
              {ship.kind} ({ship.length}) {placed.has(ship.kind) ? '✓' : ''}
            </button>
          ))}
        </div>
        <div className="button-row">
          <button onClick={() => setDirection(direction === 'H' ? 'V' : 'H')} type="button">
            Rotate ({direction})
          </button>
          <button
            onClick={() => send({ type: 'game.command', command: { type: 'fleet.random' } })}
            type="button"
          >
            Randomize
          </button>
          <button
            onClick={() => send({ type: 'game.command', command: { type: 'fleet.clear' } })}
            type="button"
          >
            Clear
          </button>
          <button
            disabled={placed.size !== 5}
            onClick={() =>
              send({ type: 'game.command', command: { type: 'fleet.commit', at: Date.now() } })
            }
            type="button"
          >
            Ready
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
          onCell={place}
          onDropShip={(cell, kind) => place(cell, kind as ShipKind)}
        />
      </div>
    </main>
  );
}
