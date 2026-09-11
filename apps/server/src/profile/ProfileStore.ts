import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1_000;

export type Difficulty = 'easy' | 'medium' | 'hard';
export type MatchWinner = 'player' | 'ai';

export interface PublicProfile {
  readonly username: string;
  readonly points: number;
}

export interface LeaderboardEntry {
  readonly name: string;
  readonly points: number;
  readonly kind: 'player' | 'ai' | 'seed';
}

interface Profile extends PublicProfile {
  readonly key: string;
  readonly passwordHash: string;
  readonly createdAt: number;
}

interface Session {
  readonly token: string;
  readonly profileKey: string;
  readonly expiresAt: number;
}

interface StoredLeaderboardEntry extends LeaderboardEntry {
  readonly key: string;
}

interface StoreData {
  readonly version: 1;
  readonly profiles: readonly Profile[];
  readonly sessions: readonly Session[];
  readonly entries: readonly StoredLeaderboardEntry[];
}

export class ProfileStoreError extends Error {
  public constructor(readonly code: 'USERNAME_TAKEN' | 'INVALID_CREDENTIALS' | 'INVALID_INPUT') {
    super(code);
  }
}

const seedEntries: readonly StoredLeaderboardEntry[] = [
  { key: 'seed:king-of-the-sea', name: 'King of the Sea', points: 1_000, kind: 'seed' },
  { key: 'seed:greta-wellen', name: 'Greta Wellen', points: 500, kind: 'seed' },
  { key: 'seed:kapitan-karel', name: 'Kapitán Karel', points: 250, kind: 'seed' },
  { key: 'seed:zofia-zagiel', name: 'Zofia Żagiel', points: 100, kind: 'seed' },
  { key: 'seed:amelie-maree', name: 'Amélie Marée', points: 50, kind: 'seed' },
  { key: 'seed:henry-harbor', name: 'Henry Harbor', points: 40, kind: 'seed' },
  { key: 'seed:lena-sturm', name: 'Lena Sturm', points: 32, kind: 'seed' },
  { key: 'seed:petr-vlna', name: 'Petr Vlna', points: 24, kind: 'seed' },
  { key: 'seed:jan-kowalski', name: 'Jan Kowalski', points: 16, kind: 'seed' },
  { key: 'seed:camille-bleu', name: 'Camille Bleu', points: 8, kind: 'seed' },
];

function emptyData(): StoreData {
  return { version: 1, profiles: [], sessions: [], entries: seedEntries };
}

function usernameKey(username: string): string {
  return username.trim().toLocaleLowerCase();
}

function validUsername(username: string): boolean {
  return /^[\p{L}\p{N}][\p{L}\p{N} ._-]{2,23}$/u.test(username);
}

function validPassword(password: string): boolean {
  return password.length >= 4 && password.length <= 64;
}

function pointsFor(difficulty: Difficulty): number {
  return difficulty === 'easy' ? 1 : difficulty === 'medium' ? 2 : 4;
}

function aiName(difficulty: Difficulty): string {
  return `${difficulty[0]!.toUpperCase()}${difficulty.slice(1)} AI`;
}

function sortEntries(
  entries: readonly StoredLeaderboardEntry[],
): readonly StoredLeaderboardEntry[] {
  return [...entries].sort(
    (left, right) => right.points - left.points || left.name.localeCompare(right.name),
  );
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `${salt}:${derived.toString('hex')}`;
}

async function passwordMatches(password: string, encoded: string): Promise<boolean> {
  const [salt, expected] = encoded.split(':');
  if (!salt || !expected) return false;
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  const expectedBuffer = Buffer.from(expected, 'hex');
  return expectedBuffer.length === derived.length && timingSafeEqual(expectedBuffer, derived);
}

/**
 * Small durable store for a private LAN host. It uses atomic file replacement and serial writes;
 * it intentionally avoids a database service for a 1–20 person party game.
 */
export class ProfileStore {
  private data: StoreData = emptyData();
  private writeQueue: Promise<void> = Promise.resolve();

  public constructor(
    private readonly filePath: string,
    private readonly now: () => number = Date.now,
  ) {}

  public async initialize(): Promise<void> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.filePath, 'utf8'));
      if (!this.isStoreData(parsed)) throw new Error('invalid profile store');
      this.data = this.removeExpiredSessions(parsed);
      await this.persist();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      this.data = emptyData();
      await this.persist();
    }
  }

  public leaderboard(): readonly LeaderboardEntry[] {
    return sortEntries(this.data.entries)
      .slice(0, 10)
      .map(({ name, points, kind }) => ({
        name,
        points,
        kind,
      }));
  }

  public async register(
    username: string,
    password: string,
  ): Promise<{ profile: PublicProfile; token: string }> {
    const cleanName = username.trim();
    if (!validUsername(cleanName) || !validPassword(password))
      throw new ProfileStoreError('INVALID_INPUT');
    const key = usernameKey(cleanName);
    if (
      this.data.profiles.some((profile) => profile.key === key) ||
      this.data.entries.some((entry) => usernameKey(entry.name) === key)
    )
      throw new ProfileStoreError('USERNAME_TAKEN');
    const profile: Profile = {
      key,
      username: cleanName,
      points: 0,
      passwordHash: await hashPassword(password),
      createdAt: this.now(),
    };
    const token = this.newToken();
    this.data = {
      ...this.data,
      profiles: [...this.data.profiles, profile],
      sessions: [
        ...this.data.sessions,
        { token, profileKey: key, expiresAt: this.now() + SESSION_LIFETIME_MS },
      ],
    };
    await this.persist();
    return { profile: this.publicProfile(profile), token };
  }

  public async login(
    username: string,
    password: string,
  ): Promise<{ profile: PublicProfile; token: string }> {
    const profile = this.data.profiles.find((candidate) => candidate.key === usernameKey(username));
    if (!profile || !(await passwordMatches(password, profile.passwordHash)))
      throw new ProfileStoreError('INVALID_CREDENTIALS');
    const token = this.newToken();
    this.data = {
      ...this.data,
      sessions: [
        ...this.removeExpiredSessions(this.data).sessions,
        { token, profileKey: profile.key, expiresAt: this.now() + SESSION_LIFETIME_MS },
      ],
    };
    await this.persist();
    return { profile: this.publicProfile(profile), token };
  }

  public async logout(token: string): Promise<void> {
    this.data = {
      ...this.data,
      sessions: this.data.sessions.filter((session) => session.token !== token),
    };
    await this.persist();
  }

  public activeUser(token: string | undefined): PublicProfile | null {
    if (!token) return null;
    const session = this.data.sessions.find(
      (candidate) => candidate.token === token && candidate.expiresAt > this.now(),
    );
    if (!session) return null;
    const profile = this.data.profiles.find((candidate) => candidate.key === session.profileKey);
    return profile ? this.publicProfile(profile) : null;
  }

  public async recordAiMatch(
    difficulty: Difficulty,
    winner: MatchWinner,
    profile: PublicProfile | null,
  ): Promise<readonly LeaderboardEntry[]> {
    const winnerName = winner === 'player' ? profile?.username : aiName(difficulty);
    if (!winnerName) return this.leaderboard();
    const winnerKey =
      winner === 'player' ? `player:${usernameKey(winnerName)}` : `ai:${difficulty}`;
    const points = pointsFor(difficulty);
    this.data = this.award(
      this.data,
      winnerKey,
      winnerName,
      winner === 'player' ? 'player' : 'ai',
      points,
    );
    await this.persist();
    return this.leaderboard();
  }

  public async recordPvpWin(username: string | undefined): Promise<readonly LeaderboardEntry[]> {
    if (!username) return this.leaderboard();
    const profile = this.data.profiles.find((candidate) => candidate.key === usernameKey(username));
    if (!profile) return this.leaderboard();
    this.data = this.award(this.data, `player:${profile.key}`, profile.username, 'player', 3);
    await this.persist();
    return this.leaderboard();
  }

  private award(
    data: StoreData,
    key: string,
    name: string,
    kind: LeaderboardEntry['kind'],
    points: number,
  ): StoreData {
    const current = data.entries.find((entry) => entry.key === key);
    const entries = current
      ? data.entries.map((entry) =>
          entry.key === key ? { ...entry, points: entry.points + points } : entry,
        )
      : [...data.entries, { key, name, kind, points }];
    const profileKey = kind === 'player' ? key.slice('player:'.length) : null;
    const profiles = profileKey
      ? data.profiles.map((profile) =>
          profile.key === profileKey ? { ...profile, points: profile.points + points } : profile,
        )
      : data.profiles;
    return { ...data, entries, profiles };
  }

  private publicProfile(profile: Profile): PublicProfile {
    return { username: profile.username, points: profile.points };
  }

  private newToken(): string {
    return randomBytes(32).toString('base64url');
  }

  private removeExpiredSessions(data: StoreData): StoreData {
    return { ...data, sessions: data.sessions.filter((session) => session.expiresAt > this.now()) };
  }

  private async persist(): Promise<void> {
    const write = async (): Promise<void> => {
      await mkdir(dirname(this.filePath), { recursive: true });
      const temporary = `${this.filePath}.tmp`;
      await writeFile(temporary, `${JSON.stringify(this.data, null, 2)}\n`, { mode: 0o600 });
      await rename(temporary, this.filePath);
    };
    this.writeQueue = this.writeQueue.then(write, write);
    await this.writeQueue;
  }

  private isStoreData(value: unknown): value is StoreData {
    return (
      value !== null &&
      typeof value === 'object' &&
      'version' in value &&
      value.version === 1 &&
      'profiles' in value &&
      Array.isArray(value.profiles) &&
      'sessions' in value &&
      Array.isArray(value.sessions) &&
      'entries' in value &&
      Array.isArray(value.entries)
    );
  }
}
