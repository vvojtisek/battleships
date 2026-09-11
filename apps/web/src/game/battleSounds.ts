import type { ProjectedRoomState } from '@bs/engine';
import { useEffect, useRef } from 'react';

export type BattleSound = 'miss' | 'hit' | 'sunk';

export const SOUND_ASSETS: Readonly<Record<BattleSound, string>> = {
  miss: '/sounds/water-splash.mp3',
  hit: '/sounds/explosion.mp3',
  sunk: '/sounds/underwater-explosion.mp3',
};

const effectDurations: Readonly<Record<BattleSound, number>> = {
  miss: 1_000,
  hit: 1_100,
  sunk: 1_800,
};

export interface BattleSoundState {
  readonly playerShots: bigint;
  readonly playerHits: bigint;
  readonly enemyShots: bigint;
  readonly enemyHits: bigint;
  readonly playerSunk: number;
  readonly enemySunk: number;
}

function sunkShips(snapshot: ProjectedRoomState): number {
  const incoming = BigInt(`0x${snapshot.you.incoming}`);
  return snapshot.you.ships.filter((ship) =>
    ship.cells.every((cell) => (incoming & (1n << BigInt(cell))) !== 0n),
  ).length;
}

export function soundState(snapshot: ProjectedRoomState): BattleSoundState {
  return {
    playerShots: BigInt(`0x${snapshot.opponent.shotsFired}`),
    playerHits: BigInt(`0x${snapshot.opponent.shotsHit}`),
    enemyShots: BigInt(`0x${snapshot.you.incoming}`),
    enemyHits:
      BigInt(`0x${snapshot.you.incoming}`) &
      snapshot.you.ships.reduce(
        (fleet, ship) => ship.cells.reduce((mask, cell) => mask | (1n << BigInt(cell)), fleet),
        0n,
      ),
    playerSunk: snapshot.opponent.sunk.length,
    enemySunk: sunkShips(snapshot),
  };
}

function shotSound(
  previousShots: bigint,
  previousHits: bigint,
  nextShots: bigint,
  nextHits: bigint,
): BattleSound | null {
  if (previousShots === nextShots) return null;
  return previousHits === nextHits ? 'miss' : 'hit';
}

export function soundsForChange(
  previous: BattleSoundState,
  next: BattleSoundState,
): readonly BattleSound[] {
  const sounds: BattleSound[] = [];
  const playerShot = shotSound(
    previous.playerShots,
    previous.playerHits,
    next.playerShots,
    next.playerHits,
  );
  const enemyShot = shotSound(
    previous.enemyShots,
    previous.enemyHits,
    next.enemyShots,
    next.enemyHits,
  );
  if (playerShot) sounds.push(playerShot);
  if (enemyShot) sounds.push(enemyShot);
  if (next.playerSunk > previous.playerSunk || next.enemySunk > previous.enemySunk)
    sounds.push('sunk');
  return sounds;
}

function playSample(
  sound: BattleSound,
  clips: Readonly<Record<BattleSound, HTMLAudioElement>>,
  stopTimers: Map<BattleSound, number>,
): void {
  const clip = clips[sound];
  const previousTimer = stopTimers.get(sound);
  if (previousTimer !== undefined) window.clearTimeout(previousTimer);
  clip.pause();
  clip.currentTime = 0;
  void clip.play().catch(() => undefined);
  stopTimers.set(
    sound,
    window.setTimeout(() => {
      clip.pause();
      clip.currentTime = 0;
      stopTimers.delete(sound);
    }, effectDurations[sound]),
  );
}

/** Plays bundled samples after a browser user gesture unlocks media playback. */
export function useBattleSounds(snapshot: ProjectedRoomState, enabled: boolean): void {
  const previous = useRef<BattleSoundState | null>(null);
  const clips = useRef<Readonly<Record<BattleSound, HTMLAudioElement>> | null>(null);
  const stopTimers = useRef(new Map<BattleSound, number>());

  useEffect(() => {
    if (!enabled) return;
    const loaded = Object.fromEntries(
      (Object.entries(SOUND_ASSETS) as readonly [BattleSound, string][]).map(([sound, source]) => {
        const clip = new Audio(source);
        clip.preload = 'auto';
        clip.volume = sound === 'miss' ? 0.5 : 0.42;
        return [sound, clip];
      }),
    ) as Record<BattleSound, HTMLAudioElement>;
    clips.current = loaded;
    const unlock = (): void => {
      for (const clip of Object.values(loaded)) {
        clip.muted = true;
        void clip
          .play()
          .then(() => {
            clip.pause();
            clip.currentTime = 0;
            clip.muted = false;
          })
          .catch(() => {
            clip.muted = false;
          });
      }
      window.removeEventListener('pointerdown', unlock);
    };
    window.addEventListener('pointerdown', unlock, { passive: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      stopTimers.current.forEach((timer) => window.clearTimeout(timer));
      stopTimers.current.clear();
      for (const clip of Object.values(loaded)) {
        clip.pause();
        clip.src = '';
      }
      clips.current = null;
    };
  }, [enabled]);

  useEffect(() => {
    const current = soundState(snapshot);
    const prior = previous.current;
    previous.current = current;
    const loaded = clips.current;
    if (!prior || !enabled || !loaded) return;
    const effects = soundsForChange(prior, current);
    if (effects.length === 0) return;
    effects.forEach((effect, index) => {
      window.setTimeout(() => playSample(effect, loaded, stopTimers.current), index * 220);
    });
  }, [enabled, snapshot]);
}
