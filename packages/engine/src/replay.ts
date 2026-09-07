import type { Command } from './reduce.js';
import { reduce } from './reduce.js';
import type { RoomState } from './state.js';

export function replay(initial: RoomState, commands: readonly Command[]): RoomState {
  return commands.reduce((state, command) => {
    const result = reduce(state, command);
    if (!result.ok) throw new Error(`${result.code}: ${result.detail}`);
    return result.value.state;
  }, initial);
}

export function canonicalState(state: RoomState): string {
  return JSON.stringify(state, (_key, value: unknown) =>
    typeof value === 'bigint' ? { $bigint: value.toString(16) } : value,
  );
}

export function stateHash(state: RoomState): string {
  let high = 0x811c9dc5;
  let low = 0x01000193;
  for (const character of canonicalState(state)) {
    high ^= character.charCodeAt(0);
    high = Math.imul(high, 0x01000193) >>> 0;
    low ^= high >>> 16;
    low = Math.imul(low, 0x85ebca6b) >>> 0;
  }
  return `${high.toString(16).padStart(8, '0')}${low.toString(16).padStart(8, '0')}`;
}
