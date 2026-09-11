import type { ProjectedRoomState } from '@bs/engine';
import { useEffect, useRef } from 'react';

export type BattleSound = 'miss' | 'hit' | 'sunk';

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

function tone(
  context: AudioContext,
  start: number,
  duration: number,
  from: number,
  to: number,
  type: OscillatorType,
  volume: number,
): void {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(from, start);
  oscillator.frequency.exponentialRampToValueAtTime(Math.max(30, to), start + duration);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.02);
}

function noise(context: AudioContext, start: number, duration: number, volume: number): void {
  const buffer = context.createBuffer(
    1,
    Math.ceil(context.sampleRate * duration),
    context.sampleRate,
  );
  const data = buffer.getChannelData(0);
  for (let index = 0; index < data.length; index += 1) data[index] = Math.random() * 2 - 1;
  const source = context.createBufferSource();
  const filter = context.createBiquadFilter();
  const gain = context.createGain();
  filter.type = 'bandpass';
  filter.frequency.value = 180;
  filter.Q.value = 0.7;
  gain.gain.setValueAtTime(volume, start);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  source.buffer = buffer;
  source.connect(filter).connect(gain).connect(context.destination);
  source.start(start);
  source.stop(start + duration);
}

function play(context: AudioContext, sound: BattleSound, start: number): void {
  if (sound === 'miss') {
    tone(context, start, 0.16, 900, 210, 'sine', 0.12);
    tone(context, start + 0.08, 0.11, 280, 95, 'sine', 0.06);
    return;
  }
  if (sound === 'hit') {
    noise(context, start, 0.28, 0.16);
    tone(context, start, 0.22, 130, 55, 'square', 0.1);
    return;
  }
  tone(context, start, 0.42, 620, 95, 'triangle', 0.13);
  tone(context, start + 0.13, 0.32, 260, 70, 'sine', 0.08);
  noise(context, start + 0.2, 0.22, 0.07);
}

/** Plays local-only procedural effects after a browser user gesture unlocks Web Audio. */
export function useBattleSounds(snapshot: ProjectedRoomState, enabled: boolean): void {
  const previous = useRef<BattleSoundState | null>(null);
  const context = useRef<AudioContext | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const unlock = (): void => {
      if (typeof AudioContext === 'undefined') return;
      try {
        context.current ??= new AudioContext();
      } catch {
        return;
      }
      if (context.current.state === 'suspended')
        void context.current.resume().catch(() => undefined);
    };
    window.addEventListener('pointerdown', unlock, { passive: true });
    return () => window.removeEventListener('pointerdown', unlock);
  }, [enabled]);

  useEffect(() => {
    const current = soundState(snapshot);
    const prior = previous.current;
    previous.current = current;
    if (!prior || !enabled || !context.current) return;
    const effects = soundsForChange(prior, current);
    if (effects.length === 0) return;
    const audio = context.current;
    void audio
      .resume()
      .then(() => {
        const start = audio.currentTime;
        effects.forEach((effect, index) => play(audio, effect, start + index * 0.22));
      })
      .catch(() => undefined);
  }, [enabled, snapshot]);

  useEffect(
    () => () => {
      void context.current?.close();
    },
    [],
  );
}
