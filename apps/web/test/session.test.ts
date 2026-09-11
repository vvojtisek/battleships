import { describe, expect, it } from 'vitest';
import { activeUserLabel, isActiveSession, isGuestEntryRequest } from '../src/profile/session.js';

describe('session navigation state', () => {
  it('recognizes the landing-page guest entry link only when explicitly requested', () => {
    expect(isGuestEntryRequest('?guest=1')).toBe(true);
    expect(isGuestEntryRequest('?guest=0')).toBe(false);
    expect(isGuestEntryRequest('')).toBe(false);
  });

  it('treats registered and guest players as active sessions', () => {
    expect(isActiveSession({ profile: { username: 'Vlad', points: 4 }, guest: false })).toBe(true);
    expect(isActiveSession({ profile: null, guest: true })).toBe(true);
    expect(isActiveSession({ profile: null, guest: false })).toBe(false);
  });

  it('shows a clear user badge for profiles and guests', () => {
    expect(activeUserLabel({ profile: { username: 'Vlad', points: 4 }, guest: false })).toBe(
      'Vlad',
    );
    expect(activeUserLabel({ profile: null, guest: true })).toBe('Guest captain');
  });
});
