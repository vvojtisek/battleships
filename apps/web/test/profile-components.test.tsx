// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthScreen, Leaderboard, ProfileView } from '../src/components/Profile.js';
import { AuthProvider } from '../src/profile/Auth.js';

function renderWithAuth(node: React.ReactNode) {
  return render(
    <MemoryRouter>
      <AuthProvider>{node}</AuthProvider>
    </MemoryRouter>,
  );
}

describe('profile views', () => {
  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.unstubAllGlobals();
  });

  it('renders LAN leaderboard entries', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            entries: [
              { name: 'Ada', points: 12, kind: 'player' },
              { name: 'Hard AI', points: 9, kind: 'ai' },
            ],
          }),
          { status: 200 },
        ),
      ),
    );

    renderWithAuth(<Leaderboard />);

    await screen.findByText('Ada');
    expect(screen.getByText('12 pts')).toBeTruthy();
    expect(screen.getByText('AI')).toBeTruthy();
  });

  it('shows an authentication error and lets the player switch to registration', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ detail: 'Username is already registered.' }), {
            status: 409,
          }),
        ),
    );
    renderWithAuth(<AuthScreen />);

    fireEvent.click(screen.getByRole('button', { name: 'Need a profile? Register' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Username' }), {
      target: { value: 'Ada' },
    });
    fireEvent.change(screen.getByLabelText('PIN or password'), { target: { value: '1234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create profile' }));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe('Username is already registered.');
    });
  });

  it('explains the guest profile without attempting a server request', async () => {
    sessionStorage.setItem('battleships.guest-session.v1', 'active');
    renderWithAuth(<ProfileView />);

    await screen.findByRole('heading', { name: 'Guest captain' });
    expect(screen.getByText('Not tracked')).toBeTruthy();
  });
});
