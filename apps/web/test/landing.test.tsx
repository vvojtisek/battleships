// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../src/App.js';

describe('landing page', () => {
  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('starts a guest session without reloading the page', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    );

    await screen.findByRole('button', { name: 'Play as guest' });
    fireEvent.click(screen.getByRole('button', { name: 'Play as guest' }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Welcome, Guest captain' })).toBeTruthy();
    });
    expect(sessionStorage.getItem('battleships.guest-session.v1')).toBe('active');
  });
});
