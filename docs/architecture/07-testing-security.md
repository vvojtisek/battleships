# 7. Testing & Security

## 7.1 Test pyramid

| Layer | Tool | Scope | Gate |
|---|---|---|---|
| Unit + property | Vitest + `fast-check` | `@bs/engine` | **100% statements & branches** |
| Contract | Vitest + Zod | `@bs/protocol` round-trips, version negotiation | 100% of message types |
| Integration | Vitest + in-process `ws` | `RoomActor`, reconnect, timers | ≥90% |
| Component | Playwright CT | `packages/ui` primitives, a11y roles | Smoke |
| E2E | Playwright, 2 browser contexts | Full multiplayer game, disconnect/resume | 6 critical journeys |
| Performance | `k6` (WS), Lighthouse CI | 500 rooms/instance, p99 latency, bundle size | Hard budgets |
| Simulation | Custom Monte Carlo | AI strength regression | `hard` mean ≤ 48 shots |

### Property-based tests (the ones that actually find bugs)

```ts
// packages/engine/test/placement.prop.test.ts
import fc from 'fast-check';

const arbFleet = fc.integer({ min: 0, max: 2 ** 31 - 1 })
  .map((seed) => randomFleet(makeRng(seed), STANDARD_RULES));

test('every generated fleet is legal and occupies exactly 17 cells', () => {
  fc.assert(fc.property(arbFleet, (ships) => {
    const res = validateFleet(ships, STANDARD_RULES);
    expect(res.ok).toBe(true);
    expect(popcount(res.value)).toBe(TOTAL_SHIP_CELLS);
  }), { numRuns: 10_000 });
});

test('no placement mask ever wraps a row boundary', () => {
  for (const len of [2, 3, 4, 5])
    for (const bow of allCells())
      for (const dir of [0, 1] as const) {
        const m = placementMask(len, bow, dir);
        if (m === 0n) continue;
        const cells = cellsOf(m);
        const sameLine = dir === 0
          ? cells.every((c) => rowOf(c) === rowOf(cells[0]))
          : cells.every((c) => colOf(c) === colOf(cells[0]));
        expect(sameLine).toBe(true);
        expect(cells.length).toBe(len);
      }
});

test('any legal sequence of fire commands terminates in ≤100 shots per player', () => {
  fc.assert(fc.property(fc.integer(), (seed) => {
    const rng = makeRng(seed);
    const { winner, shots } = simulate(hardAi, mediumAi, rng);
    expect(winner).toBeDefined();
    expect(shots).toBeLessThanOrEqual(200);
  }), { numRuns: 2_000 });
});

test('the AI never fires at a cell it has already fired at', () => {
  fc.assert(fc.property(fc.integer(), (seed) => {
    const rng = makeRng(seed);
    let k = emptyKnowledge();
    for (let i = 0; i < CELLS; i++) {
      const c = hardAi.nextShot(k, rng);
      expect(has(k.shots, c)).toBe(false);
      k = { ...k, shots: k.shots | bit(c) };
    }
  }), { numRuns: 500 });
});

test('the density map assigns zero to any cell contradicted by a miss', () => {
  fc.assert(fc.property(arbKnowledge, (k) => {
    const d = densityMap(k);
    for (const c of cellsOf(k.shots & ~k.hits)) expect(d[c]).toBe(0);
  }), { numRuns: 5_000 });
});
```

### Replay tests

Because `RoomState` is plain data and the RNG is seeded, a game is fully described by
`(seed, Command[])`. Golden files in `packages/engine/test/replays/*.json` store a
command log plus the SHA-256 of the final state. Any behavioural change to the reducer
breaks them loudly — which is exactly what you want when the rules are the product.

### E2E critical journeys

1. Create room → copy link → second context joins → both place → play to a win.
2. Mid-game refresh of one client → resume → state matches → game continues.
3. Opponent disconnects → grace countdown visible → reconnect within grace → resume.
4. Opponent disconnects → grace expires → forfeit → winner screen.
5. Turn timeout ×3 → forfeit.
6. Rematch → fleets cleared → first turn alternates.

---

## 7.2 Anti-cheat: the board must not be on the client

The dominant cheat in browser Battleship implementations is trivial: the server sends
the whole game state, the UI hides half of it, and the player opens DevTools. Our
defence is structural, not cosmetic.

**Three layers:**

1. **Type layer.** `ProjectedRoomState` ([§3.5](./03-data-models.md#35-projected-client-visible-state))
   has no field capable of holding opponent ship positions before game over. Leaking
   requires adding a field, which requires a code review.
2. **Runtime layer.** The `RoomActor` serializes through `project()` only. There is no
   other `send` path; `Connection.send` is `private` and only reachable from the
   projection call site.
3. **CI layer.** The leak test below.

### The leak test

```ts
// apps/server/test/no-leak.test.ts
/**
 * Fuzz thousands of random game states and assert that NOTHING serialized to a viewer
 * discloses the opponent's ship positions before game over. This is the single most
 * important test in the repository.
 */
test('projected output never encodes opponent ship cells before game over', () => {
  fc.assert(fc.property(arbRoomStateInPlay, (state) => {
    for (const viewer of Object.keys(state.players) as PlayerId[]) {
      const opponent = opponentOf(state, viewer)!;
      const wire = JSON.stringify(projectRoom(state, viewer));

      // 1. The opponent's fleet bitboard must not appear in any encoding.
      for (const enc of [opponent.fleet.toString(16), opponent.fleet.toString(10),
                         opponent.fleet.toString(2)]) {
        expect(wire).not.toContain(enc);
      }
      // 2. No un-hit ship cell may appear as a coordinate, in any notation.
      const secret = opponent.fleet & ~opponent.incoming;
      for (const c of cellsOf(secret)) {
        expect(wire).not.toMatch(new RegExp(`\\b${c}\\b`));
        expect(wire).not.toContain(label(c));           // "D4"
      }
      // 3. The payload must be small enough that it cannot smuggle a board.
      expect(wire.length).toBeLessThan(4096);
    }
  }), { numRuns: 5_000 });
});
```

The same fuzz runs over every individual `ServerEvent` produced by `reduce()`, not just
snapshots — an event-level leak is the easier mistake to make.

**Not defended, and stated plainly:** in single-player the AI's board is in the
browser's memory. That is unavoidable in a client-only game and not worth engineering
against; the only person deceived is the person doing it. Ranked/multiplayer is
server-authoritative, which is where it matters.

**A trustless variant, for the record.** If a peer-to-peer mode is ever added (no
authoritative server), the honest construction is commit–reveal: each player publishes
`H(fleet ‖ nonce)` before play, and reveals `fleet ‖ nonce` at the end; the opponent
verifies the hash and that every declared hit/miss is consistent with the revealed
board. This detects board-swapping *after the fact*, not during — which is why v1 keeps
an authoritative server instead.

---

## 7.3 Input validation and sanitization

Every inbound frame passes through exactly one gate:

```ts
// apps/server/src/ws/handleMessage.ts
const MAX_FRAME = 4 * 1024;

function safeParse(raw: string): unknown {
  return JSON.parse(raw, (key, value) => {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') return undefined;
    return value;
  });
}

export function handleMessage(conn: Connection, raw: Buffer | string): void {
  if (typeof raw !== 'string') return conn.close(4400, 'binary frames not accepted');
  if (raw.length > MAX_FRAME)  return conn.close(4400, 'frame too large');
  if (!conn.bucket.take())     return conn.error('E_RATE_LIMIT');

  let parsed: unknown;
  try { parsed = safeParse(raw); } catch { return conn.close(4400, 'malformed json'); }

  const env = ClientEnvelopeSchema.safeParse(parsed);        // .strict() everywhere
  if (!env.success) return conn.error('E_MALFORMED', env.error.issues[0]?.path.join('.'));
  if (env.data.v !== PROTOCOL_VERSION) return conn.close(4426, 'protocol version');

  // Identity comes from the connection, never from the payload.
  conn.room.submit(conn.playerId, env.data, env.data.cmdId);
}
```

Specifics:

- **`.strict()` on every object schema.** Unknown keys are a hard rejection, not silently
  stripped — that closes the "smuggle a `playerId`" class of attack at the parser.
- **Prototype-pollution reviver.** `JSON.parse` itself is safe, but the parsed object
  later flows through spreads and `Object.assign`; stripping `__proto__` at parse time
  removes the hazard once.
- **Display names:** `.trim()`, NFC-normalize, reject if it contains control characters
  or bidi overrides (`U+202A–U+202E`, `U+2066–U+2069` — used for spoofing), clamp to 24
  grapheme clusters via `Intl.Segmenter`, and denylist zero-width characters. Rendered by
  React as a text node; `dangerouslySetInnerHTML` appears nowhere in the codebase and is
  banned by an ESLint rule.
- **Emotes are an enum** (ADR-09). There is no free-text channel, so there is no XSS
  sink, no profanity moderation, and no message-flood vector beyond the rate limiter.
- **Binary frames rejected** outright — the protocol is text-only in v1, so accepting
  them is pure attack surface.

---

## 7.4 Abuse and denial-of-service hardening

| Vector | Control |
|---|---|
| Command flood | Token bucket per connection: 20 tokens, refill 10/s. Exhaustion → `E_RATE_LIMIT`; three exhaustions → `close(4429)` |
| Connection flood | Max 5 concurrent sockets per IP; max 20 room creations per IP per hour (Redis counter) |
| Large frames | 4 KB cap, enforced before parsing |
| Compression amplification | `permessage-deflate` **disabled**. Our frames are ~200 bytes; the extension buys nothing and adds a memory-amplification/CPU-DoS surface |
| Slowloris on upgrade | `conn.hello` must arrive within 5 s of the socket opening, else `close(4408)` |
| Room-code enumeration | 6-char Crockford base32 = 32⁶ ≈ **1.07 × 10⁹** codes. With ~10⁴ live rooms, a blind guess hits with p ≈ 9 × 10⁻⁶. Join attempts are rate-limited to 10/min/IP, so an attacker averages ~10⁵ minutes per hit. Codes are generated with `crypto.randomBytes`, never `Math.random` |
| Offensive room codes | Crockford base32 omits `I L O U`, which kills most accidental words; a ~200-entry denylist is checked at generation and the code regenerated |
| Idle room accumulation | Lobby TTL 10 min, in-game idle TTL 30 min, `game_over` TTL 5 min; a sweeper reaps expired actors every 60 s |
| Memory per instance | `rooms_active` gauge with an admission cap; over the cap, `POST /api/rooms` returns 503 and Fly autoscales |

---

## 7.5 Transport and browser security

- **Origin validation on the WebSocket upgrade.** WebSockets are **not** protected by
  CORS; the browser will happily send a cross-site upgrade with cookies attached
  (cross-site WebSocket hijacking). We validate `Origin` against an allowlist during the
  upgrade and reject anything else with `403`. Independently, auth is a bearer token in
  the first frame rather than a cookie, so even a bypassed origin check yields an
  unauthenticated socket.
- **Never put tokens in the URL query string.** Query strings land in proxy logs, Referer
  headers, and browser history. The resume token travels in the `conn.hello` payload.
- **`wss://` only**, HSTS with `max-age=31536000; includeSubDomains; preload`.
- **CSP** (delivered as a response header from the Pages/Worker layer):

```
default-src 'self';
script-src 'self' 'sha256-<hash-of-the-inline-theme-script>';
style-src 'self' 'unsafe-inline';
img-src 'self' data:;
font-src 'self';
connect-src 'self' wss://api.<domain>;
frame-ancestors 'none';
base-uri 'none';
object-src 'none';
form-action 'none';
```

  Two honest notes: `style-src 'unsafe-inline'` is required because Motion writes inline
  `style` attributes during animation — the narrower `style-src-attr 'unsafe-inline'`
  with `style-src 'self'` is preferred where browser support allows. And the theme
  bootstrap script in [§5.6](./05-design-system.md#56-theme-switching) must be pinned by
  hash, computed at build time by a Vite plugin, not left as `'unsafe-inline'`.
- Also: `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`,
  `Permissions-Policy: geolocation=(), camera=(), microphone=(), interest-cohort=()`.
- **Resume tokens** are HMAC-SHA256 over `playerId ‖ roomId ‖ exp` with a server secret
  from the environment, compared with `crypto.timingSafeEqual`, 10-minute expiry.
  Rotating the secret invalidates all resumes — acceptable, and the correct incident
  response.

---

## 7.6 Threat model summary

| Threat | Impact | Mitigation | Residual risk |
|---|---|---|---|
| Reading the opponent's board via DevTools | Game-breaking | Server projection + leak test (§7.2) | None in multiplayer |
| Firing out of turn / twice | Game-breaking | Server turn guard + `already fired` mask (§2.6) | None |
| Illegal fleet (overlaps, 18 cells, off-board) | Game-breaking | Server-side `validateFleet` (§4.1); client validation is UX only | None |
| Replaying a captured `turn.fire` | Duplicate shot | `cmdId` idempotency cache, 60 s TTL (§2.2) | Replay after TTL is indistinguishable from a new, legal shot — harmless |
| Session hijack via stolen resume token | Seat takeover | 10-min expiry, HMAC, `sessionStorage`, TLS-only | A token stolen from the device within 10 min works. Accepted: no accounts, no stakes |
| CSWSH | Session abuse | Origin allowlist + non-cookie auth (§7.5) | None |
| Room-code enumeration | Joining a stranger's game | 10⁹ space + join rate limit (§7.4) | Statistically negligible |
| Command flood / socket flood | Availability | Token bucket, per-IP caps, frame cap (§7.4) | Distributed floods need Cloudflare/Fly edge protection |
| Malicious payload → server crash | Availability | Zod `.strict()`, frame cap, prototype-pollution reviver, `bigint` serialization guard (§3.1) | Fuzzed in CI |
| XSS via display name / chat | Account/session | Text-node rendering, no `innerHTML`, no free text, control-char stripping | None |
| Supply-chain compromise | Total | `--frozen-lockfile`, Dependabot, `pnpm audit` in CI, zero-dep engine | Standard ecosystem risk |
| Cheating vs. the AI in single-player | None (self-inflicted) | **None, deliberately** | Accepted |

## 7.7 Observability as a security control

Rejected commands are the cheapest cheat detector available. `commands_rejected_total`
is labelled by `code` and `playerId`; a player generating a burst of `E_NOT_YOUR_TURN`
or `E_ILLEGAL_PLACEMENT` is running a modified client, and the label makes that visible
in a dashboard without any bespoke anti-cheat machinery.

Logs use `pino` with a redaction list covering `fleet`, `ships`, `resumeToken`, and
`displayName`. A log line, a Sentry breadcrumb, and a crash dump must never contain an
in-progress board — otherwise §7.2's guarantee leaks out the side.
