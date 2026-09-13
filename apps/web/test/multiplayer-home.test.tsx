// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MultiplayerHome } from '../src/components/Multiplayer.js';
import { AuthProvider } from '../src/profile/Auth.js';

function LocationProbe() {
  const location = useLocation();
  return <output>{location.pathname}</output>;
}

describe('MultiplayerHome', () => {
  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.unstubAllGlobals();
  });

  it('shows a discovered LAN room and joins it with the entered guest name', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            rooms: [{ code: 'ABCDEF', creatorName: 'Mira', createdAt: Date.now() }],
          }),
          { status: 200 },
        ),
      ),
    );

    render(
      <MemoryRouter>
        <AuthProvider>
          <MultiplayerHome />
          <LocationProbe />
        </AuthProvider>
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByRole('textbox', { name: 'Guest name' }), {
      target: { value: 'Ada' },
    });
    await screen.findByText('Mira');
    fireEvent.click(screen.getByRole('button', { name: 'Join game' }));

    await waitFor(() => expect(screen.getByText('/room/ABCDEF')).toBeTruthy());
    expect(localStorage.getItem('battleships.display-name.v1')).toBe('Ada');
  });
});
