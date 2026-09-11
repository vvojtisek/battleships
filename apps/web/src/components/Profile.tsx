import { useEffect, useState, type SyntheticEvent } from 'react';
import { Link } from 'react-router';
import { serverRequest } from '../game/lanServer.js';
import { useAuth, type Profile } from '../profile/Auth.js';

interface LeaderboardEntry {
  readonly name: string;
  readonly points: number;
  readonly kind: 'player' | 'ai' | 'seed';
}

function isLeaderboardEntry(value: unknown): value is LeaderboardEntry {
  return (
    value !== null &&
    typeof value === 'object' &&
    'name' in value &&
    typeof value.name === 'string' &&
    'points' in value &&
    typeof value.points === 'number' &&
    'kind' in value &&
    (value.kind === 'player' || value.kind === 'ai' || value.kind === 'seed')
  );
}

export function Leaderboard() {
  const [entries, setEntries] = useState<readonly LeaderboardEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    async function load(): Promise<void> {
      try {
        const response = await serverRequest('/api/leaderboard', { signal: controller.signal });
        const result: unknown = await response.json();
        if (
          !response.ok ||
          !result ||
          typeof result !== 'object' ||
          !('entries' in result) ||
          !Array.isArray(result.entries) ||
          !result.entries.every(isLeaderboardEntry)
        )
          throw new Error('Could not load the shared leaderboard.');
        setEntries(result.entries);
      } catch (cause) {
        if (!(cause instanceof DOMException && cause.name === 'AbortError')) {
          setError(cause instanceof Error ? cause.message : 'Could not reach the LAN server.');
        }
      }
    }
    void load();
    return () => controller.abort();
  }, []);

  return (
    <main className="leaderboard-page">
      <p className="eyebrow">Shared home LAN ranking</p>
      <h1>Top 10 captains</h1>
      <p>Victories are shared across every device using this Battleships server.</p>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : !entries ? (
        <p>Loading rankings…</p>
      ) : (
        <ol className="leaderboard-list">
          {entries.map((entry) => (
            <li key={`${entry.kind}-${entry.name}`}>
              <span className="leaderboard-rank" />
              <strong>{entry.name}</strong>
              <span>{entry.points} pts</span>
            </li>
          ))}
        </ol>
      )}
      <Link to="/play">Play against the computer</Link>
    </main>
  );
}

export function ProfileView() {
  const { profile, loading, authenticate, logout } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: SyntheticEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await authenticate(mode, username, password);
      setPassword('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not sign in.');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <main>Loading profile…</main>;
  if (profile) return <SignedInProfile profile={profile} onLogout={() => void logout()} />;

  return (
    <main className="profile-page">
      <p className="eyebrow">Optional local profile</p>
      <h1>{mode === 'login' ? 'Welcome back' : 'Create your captain profile'}</h1>
      <p>Use a profile to collect points across your home network. Guests can still play.</p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <form className="profile-form" onSubmit={(event) => void submit(event)}>
        <label>
          Username
          <input
            autoComplete="username"
            maxLength={24}
            minLength={3}
            onChange={(event) => setUsername(event.target.value)}
            required
            value={username}
          />
        </label>
        <label>
          PIN or password
          <input
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            maxLength={64}
            minLength={4}
            onChange={(event) => setPassword(event.target.value)}
            required
            type="password"
            value={password}
          />
        </label>
        <button className="primary-button" disabled={submitting} type="submit">
          {submitting ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Create profile'}
        </button>
      </form>
      <button
        className="text-button"
        onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
        type="button"
      >
        {mode === 'login' ? 'Need a profile? Register' : 'Already registered? Log in'}
      </button>
    </main>
  );
}

function SignedInProfile({
  profile,
  onLogout,
}: {
  readonly profile: Profile;
  readonly onLogout: () => void;
}) {
  return (
    <main className="profile-page">
      <p className="eyebrow">Signed in</p>
      <h1>{profile.username}</h1>
      <div className="profile-points">
        <span>Career points</span>
        <strong>{profile.points}</strong>
      </div>
      <p>
        Your points are stored on this LAN server and appear in the shared top 10 when you rank.
      </p>
      <div className="button-row">
        <Link className="primary-link" to="/play">
          Play now
        </Link>
        <button onClick={onLogout} type="button">
          Log out
        </button>
      </div>
    </main>
  );
}
