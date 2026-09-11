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
  const { profile } = useAuth();
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
            <li
              className={entry.kind === 'ai' ? 'leaderboard-ai' : undefined}
              key={`${entry.kind}-${entry.name}`}
              {...(profile?.username === entry.name ? { 'data-active-player': 'true' } : {})}
            >
              <span className="leaderboard-rank" />
              <strong>
                {entry.name} {entry.kind === 'ai' && <small>AI</small>}
              </strong>
              <span>{entry.points} pts</span>
            </li>
          ))}
        </ol>
      )}
      <p className="leaderboard-note">
        Ties are ordered alphabetically. Your active profile is highlighted.
      </p>
    </main>
  );
}

export function AuthScreen() {
  const { authenticate } = useAuth();
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

export function ProfileView() {
  const { profile, guest, loading } = useAuth();
  if (loading) return <main>Loading profile…</main>;
  if (guest) return <GuestProfile />;
  if (profile) return <SignedInProfile profile={profile} />;
  return null;
}

function SignedInProfile({ profile }: { readonly profile: Profile }) {
  const { refresh } = useAuth();
  return (
    <main className="profile-page">
      <p className="eyebrow">Signed in</p>
      <h1>{profile.username}</h1>
      <div className="profile-points">
        <span>Career points</span>
        <strong>{profile.points}</strong>
      </div>
      <dl className="profile-stats" aria-label="Match statistics">
        <div>
          <dt>Played</dt>
          <dd>{profile.played}</dd>
        </div>
        <div>
          <dt>Wins</dt>
          <dd>{profile.wins}</dd>
        </div>
        <div>
          <dt>Losses</dt>
          <dd>{profile.losses}</dd>
        </div>
        <div>
          <dt>Win rate</dt>
          <dd>
            {profile.played === 0 ? '—' : `${Math.round((profile.wins / profile.played) * 100)}%`}
          </dd>
        </div>
      </dl>
      <p>
        Your points are stored on this LAN server and appear in the shared top 10 when you rank.
      </p>
      <div className="button-row">
        <Link className="primary-link" to="/single-player">
          Play now
        </Link>
      </div>
      <HostPartyControls onReset={refresh} />
    </main>
  );
}

function HostPartyControls({ onReset }: { readonly onReset: () => Promise<void> }) {
  const [enabled, setEnabled] = useState(false);
  const [pin, setPin] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void serverRequest('/api/party', { signal: controller.signal })
      .then(async (response) => {
        const result: unknown = await response.json();
        return result;
      })
      .then((result: unknown) => {
        if (result && typeof result === 'object' && 'resetEnabled' in result)
          setEnabled(result.resetEnabled === true);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  if (!enabled) return null;

  async function reset(): Promise<void> {
    setStatus(null);
    const response = await serverRequest('/api/party/reset', {
      method: 'POST',
      headers: { 'x-party-admin-pin': pin },
    });
    if (!response.ok) {
      setStatus('The host party PIN is incorrect.');
      return;
    }
    setPin('');
    setConfirmed(false);
    setStatus(
      'New party started. Player and AI results were cleared; historic seed scores remain.',
    );
    await onReset();
  }

  return (
    <section className="party-controls">
      <h2>Host controls</h2>
      <p>Start a new party without changing the historic seed scores.</p>
      <label>
        Host party PIN
        <input onChange={(event) => setPin(event.target.value)} type="password" value={pin} />
      </label>
      <label className="check-label">
        <input
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
          type="checkbox"
        />
        I understand this clears current player and AI results.
      </label>
      <button
        className="danger-button"
        disabled={!confirmed || !pin}
        onClick={() => void reset()}
        type="button"
      >
        Start new party
      </button>
      {status && <p role="status">{status}</p>}
    </section>
  );
}

function GuestProfile() {
  return (
    <main className="profile-page">
      <p className="eyebrow">Guest session</p>
      <h1>Guest captain</h1>
      <div className="profile-points">
        <span>Career points</span>
        <strong>Not tracked</strong>
      </div>
      <p>
        You can play solo and LAN matches. To earn a permanent place on the shared leaderboard, log
        out and create or sign in to a profile.
      </p>
      <Link className="primary-link" to="/single-player">
        Play now
      </Link>
    </main>
  );
}
