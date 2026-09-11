import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, Route, Routes } from 'react-router';
import { Battle } from './components/Battle.js';
import { FleetPlacement } from './components/FleetPlacement.js';
import { MultiplayerHome, MultiplayerRoom } from './components/Multiplayer.js';
import { Leaderboard, ProfileView } from './components/Profile.js';
import { LocalTransport } from './game/LocalTransport.js';
import { authorization, serverRequest } from './game/lanServer.js';
import type { PlayerCommand } from './game/messages.js';
import { useGame } from './store/game.js';
import { AuthProvider, useAuth } from './profile/Auth.js';

const PALETTE_KEY = 'battleships.palette.v1';

interface Palette {
  readonly water: string;
  readonly ship: string;
}

function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/iu.test(value);
}

function loadPalette(): Palette | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(PALETTE_KEY) ?? 'null');
    if (
      value &&
      typeof value === 'object' &&
      'water' in value &&
      'ship' in value &&
      isHexColor(value.water) &&
      isHexColor(value.ship)
    ) {
      return { water: value.water, ship: value.ship };
    }
  } catch {
    // Appearance preferences are optional and must never block a game.
  }
  return null;
}

function defaultPalette(theme: 'system' | 'light' | 'dark'): Palette {
  const dark =
    theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  return dark ? { water: '#17344a', ship: '#c1d5e2' } : { water: '#dceef8', ship: '#405f73' };
}

function contrastColor(color: string): string {
  const channels = [1, 3, 5].map((start) => Number.parseInt(color.slice(start, start + 2), 16));
  const [red = 0, green = 0, blue = 0] = channels;
  const luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
  return luminance > 0.52 ? '#10212d' : '#ffffff';
}

function Landing() {
  return (
    <main className="landing">
      <p className="eyebrow">Classic strategy. Modern browser.</p>
      <h1>Battleships</h1>
      <p>
        Place five ships, read the water, and sink the opposing fleet. Single-player runs entirely
        on this device.
      </p>
      <Link className="primary-link" to="/play">
        Play against the computer
      </Link>
      <Link className="secondary-link" to="/multiplayer">
        Play on your home LAN
      </Link>
      <Link className="secondary-link" to="/leaderboard">
        View top 10 captains
      </Link>
      <Link className="secondary-link" to="/profile">
        Sign in or create a profile
      </Link>
    </main>
  );
}

function Play() {
  const transport = useMemo(() => new LocalTransport(), []);
  const { snapshot, difficulty, error, setDifficulty, receive, fail, connect } = useGame();
  const { profile, token, refresh } = useAuth();
  const [palette, setPalette] = useState<Palette | null>(loadPalette);
  const recordedMatches = useRef(new Set<string>());
  const [theme, setTheme] = useState<'system' | 'light' | 'dark'>(() => {
    try {
      const saved = localStorage.getItem('theme');
      return saved === 'light' || saved === 'dark' ? saved : 'system';
    } catch {
      return 'system';
    }
  });

  useEffect(() => {
    if (theme === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
    try {
      if (theme === 'system') localStorage.removeItem('theme');
      else localStorage.setItem('theme', theme);
    } catch {
      // Theme preference is a convenience; private browsing can reject persistence.
    }
  }, [theme]);

  useEffect(() => {
    const root = document.documentElement;
    if (!palette) {
      root.style.removeProperty('--board-water');
      root.style.removeProperty('--board-grid');
      root.style.removeProperty('--ship-fill');
      root.style.removeProperty('--ship-ink');
      return;
    }
    root.style.setProperty('--board-water', palette.water);
    root.style.setProperty('--board-grid', contrastColor(palette.water));
    root.style.setProperty('--ship-fill', palette.ship);
    root.style.setProperty('--ship-ink', contrastColor(palette.ship));
    try {
      localStorage.setItem(PALETTE_KEY, JSON.stringify(palette));
    } catch {
      // Appearance preferences are optional and must never block a game.
    }
  }, [palette]);

  useEffect(() => {
    connect((command) => transport.send(command));
    const unsubscribe = transport.onEvent((event) => {
      if (event.type === 'game.snapshot') receive(event.state);
      else fail(`${event.code}: ${event.detail}`);
    });
    return () => {
      unsubscribe();
      transport.close();
    };
  }, [connect, fail, receive, transport]);

  useEffect(() => {
    transport.send({ type: 'game.new', difficulty });
  }, [difficulty, transport]);

  useEffect(() => {
    const phase = snapshot?.phase;
    if (!snapshot || !phase || phase.kind !== 'game_over') return;
    const completedMatch = snapshot;
    const winner = phase.winner;
    if (recordedMatches.current.has(completedMatch.matchId)) return;
    recordedMatches.current.add(snapshot.matchId);
    async function recordResult(): Promise<void> {
      try {
        const response = await serverRequest('/api/scores/ai', {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...authorization(token) },
          body: JSON.stringify({
            difficulty,
            winner: winner === completedMatch.you.id ? 'player' : 'ai',
          }),
        });
        if (response.ok) await refresh();
      } catch {
        // Local games remain fully playable if the LAN ranking server is offline.
      }
    }
    void recordResult();
  }, [difficulty, refresh, snapshot, token]);

  function newGame(): void {
    transport.send({ type: 'game.new', difficulty });
  }

  function updatePalette(part: keyof Palette, value: string): void {
    setPalette((current) => ({ ...(current ?? defaultPalette(theme)), [part]: value }));
  }

  function resetPalette(): void {
    setPalette(null);
    try {
      localStorage.removeItem(PALETTE_KEY);
    } catch {
      // Appearance preferences are optional and must never block a game.
    }
  }

  if (!snapshot)
    return (
      <main>
        <p>Preparing local game…</p>
      </main>
    );
  const send = (command: PlayerCommand): void => transport.send({ type: 'game.command', command });

  return (
    <>
      <nav>
        <Link to="/">Battleships</Link>
        <Link to="/multiplayer">Multiplayer</Link>
        <Link to="/leaderboard">Top 10</Link>
        <Link to="/profile">{profile ? profile.username : 'Profile'}</Link>
        <label className="difficulty-control">
          Difficulty{' '}
          <select
            value={difficulty}
            onChange={(event) => setDifficulty(event.target.value as typeof difficulty)}
          >
            <option value="easy">Easy</option>
            <option value="medium">Medium</option>
            <option value="hard">Hard</option>
          </select>
        </label>
        <div aria-label="Color theme" className="theme-control" role="group">
          {(['system', 'light', 'dark'] as const).map((choice) => (
            <button
              aria-pressed={theme === choice}
              key={choice}
              onClick={() => setTheme(choice)}
              type="button"
            >
              {choice}
            </button>
          ))}
        </div>
        <details className="appearance-control">
          <summary>Board colors</summary>
          <div>
            <label>
              Water
              <input
                aria-label="Water color"
                onChange={(event) => updatePalette('water', event.target.value)}
                type="color"
                value={palette?.water ?? defaultPalette(theme).water}
              />
            </label>
            <label>
              Ships
              <input
                aria-label="Ship color"
                onChange={(event) => updatePalette('ship', event.target.value)}
                type="color"
                value={palette?.ship ?? defaultPalette(theme).ship}
              />
            </label>
            <button disabled={!palette} onClick={resetPalette} type="button">
              Reset
            </button>
          </div>
        </details>
      </nav>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {snapshot.phase.kind === 'placing' ? (
        <FleetPlacement snapshot={snapshot} send={send} />
      ) : (
        <Battle
          difficulty={difficulty}
          {...(profile ? { playerPoints: profile.points } : {})}
          snapshot={snapshot}
          send={send}
          onNewGame={newGame}
        />
      )}
    </>
  );
}

export function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/play" element={<Play />} />
        <Route path="/multiplayer" element={<MultiplayerHome />} />
        <Route path="/room/:code" element={<MultiplayerRoom />} />
        <Route path="/leaderboard" element={<Leaderboard />} />
        <Route path="/profile" element={<ProfileView />} />
        <Route path="*" element={<Navigate replace to="/" />} />
      </Routes>
    </AuthProvider>
  );
}
