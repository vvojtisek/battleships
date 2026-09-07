import { describe, expect, it } from 'vitest';
import { ClientEnvelopeSchema } from '../src/index.js';

const cmdId = '01ARZ3NDEKTSV4RRFFQ69G5FAV';

describe('ClientEnvelopeSchema', () => {
  it('accepts a well-formed fire command', () => {
    expect(
      ClientEnvelopeSchema.safeParse({ v: 1, cmdId, type: 'turn.fire', payload: { cell: 37 } })
        .success,
    ).toBe(true);
  });

  it.each([
    { v: 1, cmdId, type: 'turn.fire', payload: { cell: 100 } },
    { v: 1, cmdId, type: 'turn.fire', payload: { cell: 5, playerId: 'victim' } },
    {
      v: 1,
      cmdId,
      type: 'room.join',
      payload: { code: 'ABCDEF', displayName: 'Ada', admin: true },
    },
    { v: 1, cmdId, type: 'conn.ping', payload: { t: 1 }, playerId: 'victim' },
    { v: 2, cmdId, type: 'turn.fire', payload: { cell: 5 } },
  ])('rejects malformed or identity-smuggling input %#', (input) => {
    expect(ClientEnvelopeSchema.safeParse(input).success).toBe(false);
  });
});
