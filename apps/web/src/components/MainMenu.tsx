import { Link } from 'react-router';
import { useAuth } from '../profile/Auth.js';

export function MainMenu() {
  const { activeUserLabel, guest } = useAuth();

  return (
    <main className="main-menu">
      <p className="eyebrow">Command center</p>
      <h1>Welcome, {activeUserLabel}</h1>
      <p>
        {guest
          ? 'You are playing as a guest. Matches are available, but guest wins do not enter the shared ranking.'
          : 'Choose a match type, review the shared ranking, or check your captain profile.'}
      </p>
      <section aria-label="Choose a game mode" className="menu-grid">
        <Link className="menu-card primary" to="/single-player">
          <strong>Single player</strong>
          <span>Challenge the computer and choose a difficulty.</span>
        </Link>
        <Link className="menu-card" to="/multiplayer">
          <strong>Multiplayer</strong>
          <span>Create or join a private game on your home network.</span>
        </Link>
        <Link className="menu-card" to="/leaderboard">
          <strong>Leaderboard</strong>
          <span>See the shared top 10 captains.</span>
        </Link>
        <Link className="menu-card" to="/profile">
          <strong>{guest ? 'Guest session' : 'Your profile'}</strong>
          <span>{guest ? 'Guest points are not retained.' : 'Review your career points.'}</span>
        </Link>
      </section>
    </main>
  );
}

export function SinglePlayerSetup() {
  return (
    <main className="match-setup">
      <p className="eyebrow">Single player</p>
      <h1>Choose your opponent</h1>
      <p>Difficulty determines the computer strategy and the points awarded for a victory.</p>
      <div aria-label="Single player difficulty" className="difficulty-cards">
        <Link className="menu-card" to="/play?difficulty=easy">
          <strong>Easy AI</strong>
          <span>+1 point for a win</span>
        </Link>
        <Link className="menu-card" to="/play?difficulty=medium">
          <strong>Medium AI</strong>
          <span>+2 points for a win</span>
        </Link>
        <Link className="menu-card primary" to="/play?difficulty=hard">
          <strong>Hard AI</strong>
          <span>+4 points for a win</span>
        </Link>
      </div>
    </main>
  );
}
