// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ProjectedRoomState } from '@bs/engine';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { Battle } from '../src/components/Battle.js';
import { MatchFrame } from '../src/components/MatchFrame.js';
import { AuthProvider } from '../src/profile/Auth.js';

function renderMatchFrame(props: Partial<React.ComponentProps<typeof MatchFrame>> = {}) {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <MatchFrame
          canForfeit={true}
          mode="Single player"
          onForfeit={() => undefined}
          phase="active"
          {...props}
        >
          <div>Match content</div>
        </MatchFrame>
      </AuthProvider>
    </MemoryRouter>,
  );
}

const gameOverSnapshot = {
  matchId: 'match-1',
  code: 'LOCAL1',
  rules: { turnSeconds: 30 },
  phase: { kind: 'game_over', winner: 'human', reason: 'sunk_all' },
  you: {
    id: 'human',
    displayName: 'You',
    ships: [],
    incoming: '0',
    committed: true,
    rematch: false,
  },
  opponent: {
    id: 'bot',
    displayName: 'Computer',
    online: true,
    shotsFired: '1',
    shotsHit: '1',
    sunk: ['carrier', 'battleship', 'cruiser', 'submarine', 'destroyer'],
    rematch: false,
  },
  seq: 10,
  serverTime: 0,
  reveal: { bot: [{ kind: 'carrier', cells: [0] }] },
} as unknown as ProjectedRoomState;

describe('match flow', () => {
  it('unlocks application navigation and direct leave after a match is over', () => {
    renderMatchFrame({ phase: 'over', canForfeit: false });

    expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Leave match' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Pause match' })).toBeNull();
  });

  it('restores pause controls after the surrender callback settles', async () => {
    let settle: (() => void) | undefined;
    renderMatchFrame({
      onForfeit: () =>
        new Promise<void>((resolve) => {
          settle = resolve;
        }),
    });

    fireEvent.click(screen.getByRole('button', { name: 'Pause match' }));
    const surrender = screen.getByRole('button', { name: 'Surrender match' });
    fireEvent.click(surrender);
    expect(surrender).toHaveProperty('disabled', true);
    settle?.();
    await waitFor(() => {
      expect(surrender).toHaveProperty('disabled', false);
    });
  });

  it('shows terminal stats, destinations, and the revealed enemy fleet', () => {
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    render(
      <Battle
        onLeaderboard={vi.fn()}
        onMainMenu={vi.fn()}
        onNewGame={vi.fn()}
        send={vi.fn()}
        snapshot={gameOverSnapshot}
      />,
    );

    expect(screen.getByRole('dialog', { name: 'You won' })).toBeTruthy();
    expect(screen.getByText('Every ship in the losing fleet was sunk.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Play again' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Choose difficulty' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Leaderboard' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Main menu' })).toBeTruthy();
    expect(
      document.querySelector('[data-board="Enemy waters board"][data-cell="0"]')?.className,
    ).toContain('ship');
  });
});
