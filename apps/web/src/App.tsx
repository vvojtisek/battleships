import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, Route, Routes } from 'react-router';
import { Battle } from './components/Battle.js';
import { FleetPlacement } from './components/FleetPlacement.js';
import { LocalTransport } from './game/LocalTransport.js';
import { useGame } from './store/game.js';

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
    </main>
  );
}

function Play() {
  const transport = useMemo(() => new LocalTransport(), []);
  const { snapshot, difficulty, error, setDifficulty, receive, fail, connect } = useGame();
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

  function newGame(): void {
    transport.send({ type: 'game.new', difficulty });
  }

  if (!snapshot)
    return (
      <main>
        <p>Preparing local game…</p>
      </main>
    );
  const send = (command: Parameters<LocalTransport['send']>[0]): void => transport.send(command);

  return (
    <>
      <nav>
        <Link to="/">Battleships</Link>
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
      </nav>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {snapshot.phase.kind === 'placing' ? (
        <FleetPlacement snapshot={snapshot} send={send} />
      ) : (
        <Battle snapshot={snapshot} send={send} onNewGame={newGame} />
      )}
    </>
  );
}

function RoomPlaceholder() {
  return (
    <main className="landing">
      <h1>Multiplayer rooms</h1>
      <p>Real-time rooms arrive in Phase 4. Single-player is available now.</p>
      <Link to="/play">Play locally</Link>
    </main>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/play" element={<Play />} />
      <Route path="/room/:code" element={<RoomPlaceholder />} />
      <Route path="*" element={<Navigate replace to="/" />} />
    </Routes>
  );
}
