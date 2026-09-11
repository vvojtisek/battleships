import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, Outlet, Route, Routes, useNavigate, useSearchParams } from 'react-router';
import { AppNav } from './components/AppNav.js';
import { Battle } from './components/Battle.js';
import { FleetPlacement } from './components/FleetPlacement.js';
import { MainMenu, SinglePlayerSetup } from './components/MainMenu.js';
import { MatchFrame } from './components/MatchFrame.js';
import { MultiplayerHome, MultiplayerRoom } from './components/Multiplayer.js';
import { AuthScreen, Leaderboard, ProfileView } from './components/Profile.js';
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

function isNamedLeaderboardEntry(value: unknown): value is { readonly name: string } {
  return (
    value !== null && typeof value === 'object' && 'name' in value && typeof value.name === 'string'
  );
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
  const navigate = useNavigate();
  const { active, enterGuest, loading } = useAuth();
  useEffect(() => {
    if (active) void navigate('/menu', { replace: true });
  }, [active, navigate]);
  if (loading) return <main>Restoring player session…</main>;
  if (active) return <main>Opening main menu…</main>;

  function playAsGuest(): void {
    enterGuest();
  }

  return (
    <main className="landing">
      <p className="eyebrow">Classic strategy. Modern browser.</p>
      <h1>Battleships</h1>
      <p>Choose how you want to join this private home-LAN game.</p>
      <Link className="primary-link" to="/auth">
        Log in or register
      </Link>
      <button className="guest-entry" onClick={playAsGuest} type="button">
        Play as guest
      </button>
    </main>
  );
}

function Play() {
  const transport = useMemo(() => new LocalTransport(), []);
  const { snapshot, difficulty, error, receive, fail, connect } = useGame();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { profile, token, refresh } = useAuth();
  const [palette, setPalette] = useState<Palette | null>(loadPalette);
  const [scoreMessage, setScoreMessage] = useState<string | null>(null);
  const recordedMatches = useRef(new Set<string>());
  const [theme, setTheme] = useState<'system' | 'light' | 'dark'>(() => {
    try {
      const saved = localStorage.getItem('theme');
      return saved === 'light' || saved === 'dark' ? saved : 'system';
    } catch {
      return 'system';
    }
  });
  const requestedDifficulty = searchParams.get('difficulty');
  const matchDifficulty =
    requestedDifficulty === 'easy' ||
    requestedDifficulty === 'medium' ||
    requestedDifficulty === 'hard'
      ? requestedDifficulty
      : difficulty;

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
    transport.send({ type: 'game.new', difficulty: matchDifficulty });
  }, [matchDifficulty, transport]);

  async function recordAiResult(winner: 'player' | 'ai', matchId: string): Promise<void> {
    try {
      const response = await serverRequest('/api/scores/ai', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authorization(token) },
        body: JSON.stringify({ difficulty: matchDifficulty, winner, matchId }),
      });
      if (!response.ok) return;
      const result: unknown = await response.json();
      if (winner === 'player') {
        const points = matchDifficulty === 'easy' ? 1 : matchDifficulty === 'medium' ? 2 : 4;
        const rank =
          result &&
          typeof result === 'object' &&
          'entries' in result &&
          Array.isArray(result.entries) &&
          profile
            ? result.entries.findIndex(
                (entry) => isNamedLeaderboardEntry(entry) && entry.name === profile.username,
              )
            : -1;
        setScoreMessage(
          rank >= 0
            ? `Victory recorded: +${points} points. You are now rank ${rank + 1}.`
            : `Victory recorded: +${points} points. Keep playing to reach the top 10.`,
        );
      }
      await refresh();
    } catch {
      // Local games remain fully playable if the LAN ranking server is offline.
    }
  }

  useEffect(() => {
    const phase = snapshot?.phase;
    if (!snapshot || !phase || phase.kind !== 'game_over') return;
    const completedMatch = snapshot;
    const winner = phase.winner;
    if (recordedMatches.current.has(completedMatch.matchId)) return;
    recordedMatches.current.add(snapshot.matchId);
    void recordAiResult(winner === completedMatch.you.id ? 'player' : 'ai', completedMatch.matchId);
  }, [matchDifficulty, profile, refresh, snapshot, token]);

  function newGame(): void {
    transport.send({ type: 'game.new', difficulty: matchDifficulty });
  }

  async function forfeit(): Promise<void> {
    if (snapshot) recordedMatches.current.add(snapshot.matchId);
    transport.send({ type: 'game.command', command: { type: 'player.resign' } });
    await recordAiResult('ai', snapshot?.matchId ?? `forfeit-${Date.now()}`);
    void navigate('/menu', { replace: true });
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
    <MatchFrame
      mode="Single player"
      onForfeit={forfeit}
      settings={
        <section aria-label="Appearance" className="match-appearance">
          <h3>Appearance</h3>
          <div>
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
              Reset colors
            </button>
          </div>
        </section>
      }
    >
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {scoreMessage && (
        <p className="score-message" role="status">
          {scoreMessage}
        </p>
      )}
      {snapshot.phase.kind === 'placing' ? (
        <FleetPlacement snapshot={snapshot} send={send} />
      ) : (
        <Battle
          difficulty={matchDifficulty}
          {...(profile ? { playerPoints: profile.points } : {})}
          snapshot={snapshot}
          send={send}
          onNewGame={newGame}
          newGameLabel={`Play ${matchDifficulty[0]!.toUpperCase()}${matchDifficulty.slice(1)} AI again`}
          onChooseDifficulty={() => void navigate('/single-player')}
        />
      )}
    </MatchFrame>
  );
}

function RequireActive({ children }: { readonly children: React.ReactNode }) {
  const { active, loading } = useAuth();
  if (loading) return <main>Restoring player session…</main>;
  return active ? children : <Navigate replace to="/" />;
}

function RedirectIfActive({ children }: { readonly children: React.ReactNode }) {
  const { active, loading } = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    if (active) void navigate('/menu', { replace: true });
  }, [active, navigate]);
  if (loading) return <main>Restoring player session…</main>;
  return active ? <main>Opening main menu…</main> : children;
}

function IdleLayout() {
  return (
    <>
      <AppNav />
      <Outlet />
    </>
  );
}

export function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route
          path="/auth"
          element={
            <RedirectIfActive>
              <AuthScreen />
            </RedirectIfActive>
          }
        />
        <Route
          element={
            <RequireActive>
              <IdleLayout />
            </RequireActive>
          }
        >
          <Route path="/menu" element={<MainMenu />} />
          <Route path="/single-player" element={<SinglePlayerSetup />} />
          <Route path="/multiplayer" element={<MultiplayerHome />} />
          <Route path="/leaderboard" element={<Leaderboard />} />
          <Route path="/profile" element={<ProfileView />} />
        </Route>
        <Route
          path="/play"
          element={
            <RequireActive>
              <Play />
            </RequireActive>
          }
        />
        <Route
          path="/room/:code"
          element={
            <RequireActive>
              <MultiplayerRoom />
            </RequireActive>
          }
        />
        <Route path="*" element={<Navigate replace to="/" />} />
      </Routes>
    </AuthProvider>
  );
}
