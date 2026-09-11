import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { authorization, serverRequest } from '../game/lanServer.js';
import { profileFrom, type Profile } from './profile.js';
import { activeUserLabel, isActiveSession, isGuestEntryRequest } from './session.js';

const SESSION_KEY = 'battleships.profile-session.v1';
const GUEST_KEY = 'battleships.guest-session.v1';

export type { Profile } from './profile.js';

interface AuthContextValue {
  readonly profile: Profile | null;
  readonly token: string | null;
  readonly guest: boolean;
  readonly active: boolean;
  readonly activeUserLabel: string;
  readonly loading: boolean;
  authenticate(mode: 'login' | 'register', username: string, password: string): Promise<void>;
  enterGuest(): void;
  logout(): Promise<void>;
  refresh(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function guestRequested(): boolean {
  try {
    return isGuestEntryRequest(window.location.search);
  } catch {
    return false;
  }
}

function loadToken(): string | null {
  try {
    if (guestRequested()) {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
    return localStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

function saveToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(SESSION_KEY, token);
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    // A guest can still play when browser storage is unavailable.
  }
}

function loadGuest(): boolean {
  try {
    const requested = guestRequested();
    if (requested) sessionStorage.setItem(GUEST_KEY, 'active');
    return requested || sessionStorage.getItem(GUEST_KEY) === 'active';
  } catch {
    return false;
  }
}

function saveGuest(guest: boolean): void {
  try {
    if (guest) sessionStorage.setItem(GUEST_KEY, 'active');
    else sessionStorage.removeItem(GUEST_KEY);
  } catch {
    // A guest can still play for the current page lifetime when session storage is unavailable.
  }
}

export function AuthProvider({ children }: { readonly children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(loadToken);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [guest, setGuest] = useState(loadGuest);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async (): Promise<void> => {
    if (!token) {
      setProfile(null);
      setLoading(false);
      return;
    }
    try {
      const response = await serverRequest('/api/auth/me', { headers: authorization(token) });
      const result: unknown = await response.json();
      if (!response.ok || !result || typeof result !== 'object' || !('profile' in result))
        throw new Error('Could not restore your profile.');
      const restoredProfile = profileFrom(result.profile);
      setProfile(restoredProfile);
      if (!restoredProfile) {
        setToken(null);
        saveToken(null);
      }
    } catch {
      // The game remains playable as a guest while the LAN host is unavailable.
      setProfile(null);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const authenticate = useCallback(
    async (mode: 'login' | 'register', username: string, password: string): Promise<void> => {
      const response = await serverRequest(`/api/auth/${mode}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const result: unknown = await response.json();
      const authenticatedProfile =
        result && typeof result === 'object' && 'profile' in result
          ? profileFrom(result.profile)
          : null;
      if (
        !response.ok ||
        !result ||
        typeof result !== 'object' ||
        !authenticatedProfile ||
        !('token' in result) ||
        typeof result.token !== 'string'
      ) {
        const detail =
          result &&
          typeof result === 'object' &&
          'detail' in result &&
          typeof result.detail === 'string'
            ? result.detail
            : 'Could not sign in.';
        throw new Error(detail);
      }
      setToken(result.token);
      saveToken(result.token);
      setProfile(authenticatedProfile);
      setGuest(false);
      saveGuest(false);
      setLoading(false);
    },
    [],
  );

  const enterGuest = useCallback((): void => {
    setToken(null);
    setProfile(null);
    setGuest(true);
    saveToken(null);
    saveGuest(true);
    setLoading(false);
  }, []);

  const logout = useCallback(async (): Promise<void> => {
    try {
      await serverRequest('/api/auth/logout', { method: 'POST', headers: authorization(token) });
    } finally {
      setToken(null);
      setProfile(null);
      setGuest(false);
      saveToken(null);
      saveGuest(false);
    }
  }, [token]);

  const value = useMemo<AuthContextValue>(() => {
    const session = { profile, guest };
    return {
      profile,
      token,
      guest,
      active: isActiveSession(session),
      activeUserLabel: activeUserLabel(session),
      loading,
      authenticate,
      enterGuest,
      logout,
      refresh,
    };
  }, [authenticate, enterGuest, guest, loading, logout, profile, refresh, token]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
