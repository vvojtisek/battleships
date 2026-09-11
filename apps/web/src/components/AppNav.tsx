import { useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router';
import { useAuth } from '../profile/Auth.js';

const destinations = [
  { to: '/menu', label: 'Main menu' },
  { to: '/single-player', label: 'Single player' },
  { to: '/multiplayer', label: 'Multiplayer' },
  { to: '/leaderboard', label: 'Leaderboard' },
] as const;

export function AppNav() {
  const navigate = useNavigate();
  const { activeUserLabel, guest, logout } = useAuth();
  const [open, setOpen] = useState(false);

  async function signOut(): Promise<void> {
    await logout();
    void navigate('/', { replace: true });
  }

  return (
    <nav aria-label="Main navigation" className="app-nav">
      <Link className="brand-link" to="/menu">
        Battleships
      </Link>
      <button
        aria-controls="primary-nav-links"
        aria-expanded={open}
        className="nav-menu-toggle"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        Menu
      </button>
      <div className="nav-destinations" id="primary-nav-links" data-open={open}>
        {destinations.map((destination) => (
          <NavLink
            className={({ isActive }) => (isActive ? 'active' : undefined)}
            key={destination.to}
            onClick={() => setOpen(false)}
            to={destination.to}
          >
            {destination.label}
          </NavLink>
        ))}
      </div>
      <div className="active-player" data-open={open}>
        <Link aria-label="Open active player profile" to="/profile">
          {activeUserLabel}
        </Link>
        {guest && <span>Guest</span>}
        <button onClick={() => void signOut()} type="button">
          Log out
        </button>
      </div>
    </nav>
  );
}
