// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from '../src/profile/Auth.js';

function SessionProbe() {
  const { active, activeUserLabel, loading } = useAuth();
  return <output>{loading ? 'loading' : `${active}:${activeUserLabel}`}</output>;
}

describe('offline authentication', () => {
  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('keeps a cached registered profile active when the LAN host cannot be reached', async () => {
    localStorage.setItem('battleships.profile-session.v1', 'offline-session-token');
    localStorage.setItem(
      'battleships.profile-cache.v1',
      JSON.stringify({ username: 'Ada', points: 7, played: 2, wins: 1, losses: 1 }),
    );
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network unavailable')));

    render(
      <AuthProvider>
        <SessionProbe />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByText('true:Ada')).toBeTruthy());
  });

  it('keeps a token-only legacy session able to open local play while offline', async () => {
    localStorage.setItem('battleships.profile-session.v1', 'offline-session-token');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network unavailable')));

    render(
      <AuthProvider>
        <SessionProbe />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByText('true:Offline captain')).toBeTruthy());
  });
});
