// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import type { ProjectedRoomState } from '@bs/engine';
import { describe, expect, it, vi } from 'vitest';
import { FleetPlacement } from '../src/components/FleetPlacement.js';

const snapshot = {
  matchId: 'match-1',
  code: 'LOCAL1',
  rules: { placementSeconds: 180, turnSeconds: 45, noTouch: true },
  phase: { kind: 'placing', deadline: 180_000 },
  you: {
    id: 'human',
    displayName: 'You',
    committed: false,
    incoming: '0',
    rematch: false,
    ships: [
      {
        id: 'carrier',
        kind: 'carrier',
        length: 5,
        bow: 0,
        dir: 'H',
        cells: [0, 1, 2, 3, 4],
      },
    ],
  },
  opponent: {
    id: 'bot',
    displayName: 'Computer',
    online: true,
    committed: false,
    shotsFired: '0',
    shotsHit: '0',
    sunk: [],
    rematch: false,
  },
  seq: 1,
  serverTime: 0,
} as unknown as ProjectedRoomState;

describe('FleetPlacement', () => {
  it('keeps a deliberately selected placed ship selected across a fresh snapshot', () => {
    const send = vi.fn();
    const view = render(<FleetPlacement send={send} snapshot={snapshot} />);

    fireEvent.click(screen.getByRole('button', { name: /destroyer 2 cells/i }));
    fireEvent.click(screen.getByRole('button', { name: /carrier 5 cells/i }));
    view.rerender(
      <FleetPlacement
        send={send}
        snapshot={{ ...snapshot, you: { ...snapshot.you, ships: [...snapshot.you.ships] } }}
      />,
    );

    expect(
      screen.getByRole('button', { name: /carrier 5 cells/i }).getAttribute('aria-pressed'),
    ).toBe('true');
  });
});
