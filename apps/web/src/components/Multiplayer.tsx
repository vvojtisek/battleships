import type { ProjectedRoomState } from '@bs/engine';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Battle } from './Battle.js';
import { FleetPlacement } from './FleetPlacement.js';
import { RemoteTransport, type RemoteEvent } from '../game/RemoteTransport.js';

const NAME_KEY = 'battleships.display-name.v1';
const tokenKey = (code: string) => `battleships.room-token.${code}`;

interface JoinableRoom {
  readonly code: string;
  readonly creatorName: string;
}

function serverUrl(): string {
  const configured = import.meta.env.VITE_SERVER_URL;
  return typeof configured === 'string'
    ? configured
    : `${window.location.protocol}//${window.location.hostname}:3000`;
}

function loadName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

function saveName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    // A name is a convenience, not a requirement for a LAN game.
  }
}

function loadToken(code: string): string | undefined {
  try {
    return localStorage.getItem(tokenKey(code)) ?? undefined;
  } catch {
    return undefined;
  }
}

function saveToken(code: string, token: string): void {
  try {
    localStorage.setItem(tokenKey(code), token);
  } catch {
    // Resume is optional when browser storage is unavailable.
  }
}

function isJoinableRoom(value: unknown): value is JoinableRoom {
  return (
    value !== null &&
    typeof value === 'object' &&
    'code' in value &&
    'creatorName' in value &&
    typeof value.code === 'string' &&
    /^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{6}$/.test(value.code) &&
    typeof value.creatorName === 'string' &&
    value.creatorName.length > 0
  );
}

export function MultiplayerHome() {
  const navigate = useNavigate();
  const [name, setName] = useState(loadName);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [rooms, setRooms] = useState<readonly JoinableRoom[]>([]);
  const [loadingRooms, setLoadingRooms] = useState(true);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();

    async function loadRooms(): Promise<void> {
      try {
        const response = await fetch(new URL('/api/rooms', serverUrl()), {
          signal: controller.signal,
        });
        const result: unknown = await response.json();
        if (!response.ok || !result || typeof result !== 'object' || !('rooms' in result)) {
          throw new Error('Could not load rooms from the LAN server.');
        }
        if (!Array.isArray(result.rooms) || !result.rooms.every(isJoinableRoom)) {
          throw new Error('The LAN server returned an invalid room list.');
        }
        if (active) setRooms(result.rooms);
      } catch (cause) {
        if (active && !(cause instanceof DOMException && cause.name === 'AbortError')) {
          setError(cause instanceof Error ? cause.message : 'Could not reach the LAN server.');
        }
      } finally {
        if (active) setLoadingRooms(false);
      }
    }

    void loadRooms();
    const refresh = window.setInterval(() => void loadRooms(), 5_000);
    return () => {
      active = false;
      controller.abort();
      window.clearInterval(refresh);
    };
  }, []);

  async function createRoom(): Promise<void> {
    const displayName = name.trim();
    if (!displayName) return setError('Enter your name before creating a room.');
    setCreating(true);
    setError(null);
    try {
      const response = await fetch(new URL('/api/rooms', serverUrl()), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ displayName }),
      });
      const room: unknown = await response.json();
      if (
        !response.ok ||
        !room ||
        typeof room !== 'object' ||
        !('code' in room) ||
        !('resumeToken' in room)
      )
        throw new Error('The LAN server could not create a room.');
      if (typeof room.code !== 'string' || typeof room.resumeToken !== 'string')
        throw new Error('The LAN server returned an invalid room.');
      saveName(displayName);
      saveToken(room.code, room.resumeToken);
      void navigate(`/room/${room.code}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not reach the LAN server.');
    } finally {
      setCreating(false);
    }
  }

  function joinRoom(room: JoinableRoom): void {
    if (!name.trim()) {
      setError('Enter your name before joining a room.');
      return;
    }
    saveName(name.trim());
    void navigate(`/room/${room.code}`);
  }

  return (
    <main className="room-home">
      <p className="eyebrow">Private home LAN</p>
      <h1>Play with someone nearby</h1>
      <p>Create a room, or join an available game on your home network.</p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <label>
        Your name
        <input maxLength={24} onChange={(event) => setName(event.target.value)} value={name} />
      </label>
      <div className="room-actions">
        <button disabled={creating} onClick={() => void createRoom()} type="button">
          {creating ? 'Creating room…' : 'Create room'}
        </button>
      </div>
      <section aria-live="polite" aria-label="Available rooms" className="room-list">
        <div className="room-list-heading">
          <h2>Available rooms</h2>
          <span>{loadingRooms ? 'Looking…' : `${rooms.length} open`}</span>
        </div>
        {loadingRooms ? (
          <p>Looking for games on your home network…</p>
        ) : rooms.length === 0 ? (
          <p>
            No rooms are open right now. Create one and it will appear here for the other player.
          </p>
        ) : (
          <ul>
            {rooms.map((room) => (
              <li key={room.code}>
                <div>
                  <strong>{room.creatorName}</strong>
                  <span>Waiting for an opponent</span>
                </div>
                <button onClick={() => joinRoom(room)} type="button">
                  Join game
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <Link to="/play">Play against the computer instead</Link>
    </main>
  );
}

export function MultiplayerRoom() {
  const navigate = useNavigate();
  const { code: rawCode } = useParams();
  const code = rawCode?.toUpperCase() ?? '';
  const [name, setName] = useState(loadName);
  const [snapshot, setSnapshot] = useState<ProjectedRoomState | null>(null);
  const [status, setStatus] = useState('Connecting to the LAN server…');
  const [error, setError] = useState<string | null>(null);
  const [resumeToken, setResumeToken] = useState(() => loadToken(code));
  const transport = useMemo(() => new RemoteTransport(serverUrl(), resumeToken), [resumeToken]);

  useEffect(() => {
    setResumeToken(loadToken(code));
  }, [code]);

  useEffect(() => {
    if (!/^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{6}$/.test(code)) {
      setError('That room code is invalid.');
      return;
    }
    setStatus('Connecting to the LAN server…');
    function receive(event: RemoteEvent): void {
      if (event.type === 'room.snapshot') {
        setSnapshot(event.state);
      } else if (event.type === 'conn.ready') {
        if (event.resumeToken && event.resumeToken !== resumeToken) {
          saveToken(code, event.resumeToken);
          setResumeToken(event.resumeToken);
          return;
        }
        setStatus(event.playerId ? 'Connected' : 'Enter your name to join this room.');
      } else if (event.type === 'error') {
        setError(event.detail);
      } else {
        setStatus(event.detail);
      }
    }
    const unsubscribe = transport.onEvent(receive);
    transport.connect();
    return () => {
      unsubscribe();
      transport.close();
    };
  }, [code, resumeToken, transport]);

  function join(): void {
    const displayName = name.trim();
    if (!displayName) return setError('Enter your name before joining.');
    saveName(displayName);
    transport.join(code, displayName);
    setStatus('Joining room…');
  }

  function send(command: Parameters<RemoteTransport['send']>[0]): void {
    if (status !== 'Connected') {
      setError('The room is still connecting. Please wait a moment.');
      return;
    }
    transport.send(command);
  }

  if (!snapshot) {
    return (
      <main className="room-home">
        <p className="eyebrow">Room {code || 'unknown'}</p>
        <h1>{status}</h1>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {!resumeToken && (
          <div className="join-form">
            <label>
              Your name
              <input
                maxLength={24}
                onChange={(event) => setName(event.target.value)}
                value={name}
              />
            </label>
            <button onClick={join} type="button">
              Join room
            </button>
          </div>
        )}
        <Link to="/multiplayer">Back to multiplayer</Link>
      </main>
    );
  }

  if (snapshot.phase.kind === 'lobby') {
    return (
      <>
        <nav>
          <Link to="/">Battleships</Link>
          <span className="connection-status">{status}</span>
        </nav>
        <main className="room-home">
          <p className="eyebrow">Private home LAN room</p>
          <h1>Room {code}</h1>
          <p>
            This room is visible to people on your home network. Their multiplayer screen will show
            your name and move both players to fleet placement as soon as they join.
          </p>
          <p aria-live="polite">Waiting for an opponent…</p>
          <Link to="/multiplayer">Create or join another room</Link>
        </main>
      </>
    );
  }

  return (
    <>
      <nav>
        <Link to="/">Battleships</Link>
        <span className="room-code">Room {code}</span>
        <span className="connection-status">{status}</span>
      </nav>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {snapshot.phase.kind === 'placing' ? (
        <FleetPlacement send={send} snapshot={snapshot} />
      ) : (
        <Battle
          newGameLabel="Find a new room"
          onNewGame={() => void navigate('/multiplayer')}
          opponentName={snapshot.opponent.displayName ?? 'Opponent'}
          send={send}
          snapshot={snapshot}
        />
      )}
    </>
  );
}
