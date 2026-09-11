import { z } from 'zod';

export const PROTOCOL_VERSION = 1;
export const CellSchema = z.number().int().min(0).max(99);
export const RoomCodeSchema = z.string().regex(/^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{6}$/);
export const ShipKindSchema = z.enum([
  'carrier',
  'battleship',
  'cruiser',
  'submarine',
  'destroyer',
]);
export const DirectionSchema = z.enum(['H', 'V']);
export const EmoteSchema = z.enum(['gg', 'nice', 'oops', 'hurry', 'thanks', 'wave']);

const HelloSchema = z
  .object({
    type: z.literal('conn.hello'),
    payload: z
      .object({
        clientVersion: z.string().min(1).max(32),
        resumeToken: z.string().max(512).optional(),
        lastSeq: z.number().int().nonnegative().optional(),
      })
      .strict(),
  })
  .strict();
const JoinSchema = z
  .object({
    type: z.literal('room.join'),
    payload: z
      .object({
        code: RoomCodeSchema,
        displayName: z.string().trim().min(1).max(24),
        sessionToken: z.string().min(1).max(512).optional(),
      })
      .strict(),
  })
  .strict();
const PlaceSchema = z
  .object({
    type: z.literal('fleet.place'),
    payload: z.object({ shipId: ShipKindSchema, bow: CellSchema, dir: DirectionSchema }).strict(),
  })
  .strict();
const RandomFleetSchema = z
  .object({ type: z.literal('fleet.random'), payload: z.object({}).strict() })
  .strict();
const ClearFleetSchema = z
  .object({ type: z.literal('fleet.clear'), payload: z.object({}).strict() })
  .strict();
const CommitSchema = z
  .object({
    type: z.literal('fleet.commit'),
    payload: z.object({ checksum: z.string().length(64) }).strict(),
  })
  .strict();
const FireSchema = z
  .object({ type: z.literal('turn.fire'), payload: z.object({ cell: CellSchema }).strict() })
  .strict();
const ResignSchema = z
  .object({ type: z.literal('player.resign'), payload: z.object({}).strict() })
  .strict();
const RematchSchema = z
  .object({ type: z.literal('game.rematch'), payload: z.object({ accept: z.boolean() }).strict() })
  .strict();
const EmoteSendSchema = z
  .object({ type: z.literal('emote.send'), payload: z.object({ id: EmoteSchema }).strict() })
  .strict();
const PingSchema = z
  .object({ type: z.literal('conn.ping'), payload: z.object({ t: z.number().finite() }).strict() })
  .strict();

export const ClientCommandSchema = z.discriminatedUnion('type', [
  HelloSchema,
  JoinSchema,
  PlaceSchema,
  RandomFleetSchema,
  ClearFleetSchema,
  CommitSchema,
  FireSchema,
  ResignSchema,
  RematchSchema,
  EmoteSendSchema,
  PingSchema,
]);

const envelope = <T extends z.ZodRawShape>(shape: T) =>
  z
    .object({
      v: z.literal(PROTOCOL_VERSION),
      cmdId: z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/),
      ...shape,
    })
    .strict();
export const ClientEnvelopeSchema = z.discriminatedUnion('type', [
  envelope({ type: z.literal('conn.hello'), payload: HelloSchema.shape.payload }),
  envelope({ type: z.literal('room.join'), payload: JoinSchema.shape.payload }),
  envelope({ type: z.literal('fleet.place'), payload: PlaceSchema.shape.payload }),
  envelope({ type: z.literal('fleet.random'), payload: RandomFleetSchema.shape.payload }),
  envelope({ type: z.literal('fleet.clear'), payload: ClearFleetSchema.shape.payload }),
  envelope({ type: z.literal('fleet.commit'), payload: CommitSchema.shape.payload }),
  envelope({ type: z.literal('turn.fire'), payload: FireSchema.shape.payload }),
  envelope({ type: z.literal('player.resign'), payload: ResignSchema.shape.payload }),
  envelope({ type: z.literal('game.rematch'), payload: RematchSchema.shape.payload }),
  envelope({ type: z.literal('emote.send'), payload: EmoteSendSchema.shape.payload }),
  envelope({ type: z.literal('conn.ping'), payload: PingSchema.shape.payload }),
]);

export type ClientCommand = z.infer<typeof ClientCommandSchema>;
/** Kept as an intersection so discriminating on `type` also narrows `payload`. */
export type ClientEnvelope = z.infer<typeof ClientCommandSchema> & {
  readonly v: typeof PROTOCOL_VERSION;
  readonly cmdId: string;
};

export interface Transport<TCommand, TEvent> {
  send(command: TCommand): void;
  onEvent(handler: (event: TEvent) => void): () => void;
  readonly status: 'connecting' | 'open' | 'resuming' | 'closed';
  close(): void;
}
