import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { authorization, serverRequest } from '../game/lanServer.js';

const SESSION_KEY = 'battleships.profile-session.v1';

export interface Profile {
  readonly username: string;
  readonly points: number;
}

interface AuthContextValue {
  readonly profile: Profile | null;
  readonly token: string | null;
  readonly loading: boolean;
  authenticate(mode: 'login' | 'register', username: string, password: string): Promise<void>;
  logout(): Promise<void>;
  refresh(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function loadToken(): string | null {
  try {
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

function isProfile(value: unknown): value is Profile {
  return (
    value !== null &&
    typeof value === 'object' &&
    'username' in value &&
    typeof value.username === 'string' &&
    'points' in value &&
    typeof value.points === 'number'
  );
}

export function AuthProvider({ children }: { readonly children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(loadToken);
  const [profile, setProfile] = useState<Profile | null>(null);
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
      setProfile(isProfile(result.profile) ? result.profile : null);
      if (!isProfile(result.profile)) {
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
      if (
        !response.ok ||
        !result ||
        typeof result !== 'object' ||
        !('profile' in result) ||
        !isProfile(result.profile) ||
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
      setProfile(result.profile);
      setLoading(false);
    },
    [],
  );

  const logout = useCallback(async (): Promise<void> => {
    try {
      await serverRequest('/api/auth/logout', { method: 'POST', headers: authorization(token) });
    } finally {
      setToken(null);
      setProfile(null);
      saveToken(null);
    }
  }, [token]);

  const value = useMemo<AuthContextValue>(
    () => ({ profile, token, loading, authenticate, logout, refresh }),
    [authenticate, loading, logout, profile, refresh, token],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
