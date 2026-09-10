import { has, type Board as BitBoard, type Cell } from '@bs/engine';
import type { KeyboardEvent } from 'react';

interface BoardProps {
  readonly label: string;
  readonly fleet?: BitBoard;
  readonly shots: BitBoard;
  readonly hits: BitBoard;
  readonly disabled?: boolean;
  readonly preview?: BitBoard;
  readonly previewState?: 'valid' | 'invalid';
  readonly onCell?: (cell: Cell) => void;
  readonly onPreviewCell?: (cell: Cell) => void;
  readonly onDropShip?: (cell: Cell, shipKind: string) => void;
}

export function Board({
  label,
  fleet = 0n,
  shots,
  hits,
  disabled = false,
  preview = 0n,
  previewState = 'valid',
  onCell,
  onPreviewCell,
  onDropShip,
}: BoardProps) {
  function moveFocus(event: KeyboardEvent<HTMLButtonElement>, cell: number): void {
    const delta =
      event.key === 'ArrowLeft'
        ? -1
        : event.key === 'ArrowRight'
          ? 1
          : event.key === 'ArrowUp'
            ? -10
            : event.key === 'ArrowDown'
              ? 10
              : 0;
    if (delta === 0) return;
    const next = cell + delta;
    const wraps = (delta === -1 && cell % 10 === 0) || (delta === 1 && cell % 10 === 9);
    if (next < 0 || next > 99 || wraps) return;
    event.preventDefault();
    document
      .querySelector<HTMLButtonElement>(`[data-board="${label}"][data-cell="${next}"]`)
      ?.focus();
  }

  return (
    <section className="board-wrap" aria-label={label}>
      <div className="column-labels" aria-hidden="true">
        <span />
        {Array.from('ABCDEFGHIJ', (letter) => (
          <span key={letter}>{letter}</span>
        ))}
      </div>
      <div className="board-body">
        <div className="row-labels" aria-hidden="true">
          {Array.from({ length: 10 }, (_, index) => (
            <span key={index}>{index + 1}</span>
          ))}
        </div>
        <div aria-label={label} className="board" role="grid">
          {Array.from({ length: 100 }, (_, index) => {
            const cell = index as Cell;
            const wasShot = has(shots, cell);
            const wasHit = has(hits, cell);
            const occupied = has(fleet, cell);
            const previewed = has(preview, cell);
            const state = wasHit ? 'hit' : wasShot ? 'miss' : occupied ? 'ship' : 'unknown';
            const className = [
              'cell',
              occupied ? 'ship' : '',
              wasShot ? (wasHit ? 'hit' : 'miss') : '',
              previewed ? `preview-${previewState}` : '',
            ]
              .filter(Boolean)
              .join(' ');
            return (
              <button
                aria-label={`${String.fromCharCode(65 + (index % 10))}${Math.floor(index / 10) + 1}, ${state}`}
                className={className}
                data-board={label}
                data-cell={index}
                data-state={state}
                disabled={disabled || wasShot}
                key={index}
                onClick={() => onCell?.(cell)}
                onFocus={() => onPreviewCell?.(cell)}
                onDragOver={(event) => {
                  if (onDropShip) event.preventDefault();
                }}
                onDrop={(event) => {
                  const kind = event.dataTransfer.getData('application/x-battleship-kind');
                  if (kind) onDropShip?.(cell, kind);
                }}
                onKeyDown={(event) => moveFocus(event, index)}
                onPointerEnter={() => onPreviewCell?.(cell)}
                type="button"
              >
                <span aria-hidden="true" />
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
