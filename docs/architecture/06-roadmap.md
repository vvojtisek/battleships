# 6. Phased Implementation Roadmap

Each phase has a **demoable output** and **exit criteria**. Phases are ordered so that
the highest-risk, highest-leverage work (the engine) lands first and everything after it
is decoration on a proven core. Estimates assume one experienced full-stack engineer;
halve the calendar with two, but do not parallelize Phase 1.

---

## Phase 0 — Repository foundation (0.5 day)

**Do:**

```bash
pnpm init && pnpm dlx tsc --init
# pnpm-workspace.yaml
packages: ['apps/*', 'packages/*']
```

- `packages/{engine,protocol,ui}`, `apps/{web,server}` with TypeScript project
  references and `"composite": true`.
- Root `tsconfig.base.json`: `strict`, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `moduleResolution: "bundler"`.
- ESLint 9 flat config + Prettier; `@bs/engine` gets extra rules:
  `no-restricted-globals: [Math.random, Date, crypto]` (the engine must be pure).
- Vitest at the root with workspace projects; Husky + lint-staged.
- `.github/workflows/ci.yml` from [§1.5](./01-tech-stack.md#15-cicd).

**Exit:** `pnpm -r typecheck && pnpm -r lint && pnpm -r test` green on an empty repo, CI
passing on a PR.

---

## Phase 1 — Rules engine (2–3 days) — *the critical path*

**Do:** implement `@bs/engine` completely, with no UI and no server.

- `coords.ts`, `board.ts` (bitboards), `placement.ts` (mask tables), `state.ts`
  (`RoomState`, `Phase`), `reduce.ts` (the pure command reducer), `projection.ts`,
  `rng.ts`.
- Property-based tests with `fast-check` ([§7.1](./07-testing-security.md#71-test-pyramid)).
- Replay harness: `(seed, Command[]) -> stateHash`.

**Exit:**
- 100% statement **and branch** coverage on `@bs/engine`, enforced in CI.
- Property tests pass 10 000 cases per invariant.
- Zero dependencies in `packages/engine/package.json`.
- A headless script plays a full game via `reduce()` alone.

> This phase is the whole project's insurance policy. Do not start the UI before it is
> done; every hour of UI work built on an unstable engine is paid back twice.

---

## Phase 2 — Single-player, playable end to end (3–4 days)

**Do:**

- Vite + React app shell, three routes, Zustand store wired to `reduce()`.
- `LocalTransport` + Web Worker hosting `RoomActor` and the AI.
- AI tiers Easy/Medium/Hard ([§4.3](./04-core-algorithms.md#43-ai-opponent)) + the
  Monte Carlo benchmark, wired into CI as a regression gate.
- Board rendering, ship placement by drag and by keyboard, firing, win/lose screen.
- Deliberately **unstyled** — system fonts, default colors, no animation. Prove the game
  works before making it beautiful.

**Exit:** a full game vs. Hard AI is playable in the browser, offline, with the network
tab empty. `hard` benchmark mean ≤ 48 shots.

---

## Phase 3 — Design system pass (3–4 days)

**Do:** implement [§5](./05-design-system.md) in `packages/ui`.

- Tokens (`theme.css`), typography scale, materials, radii, shadows.
- Primitives: `Button`, `SegmentedControl`, `Card`, `Sheet`, `Toast`, `Switch`,
  `Loupe` — built on Radix where a11y semantics matter.
- Motion: `SPRING` presets, the full motion inventory, reduced-motion handling.
- Light/dark/system toggle with pre-paint application.
- Responsive board layouts at the three breakpoints; touch loupe.

**Exit:** axe-core clean in both themes; Lighthouse ≥ 95 performance / 100 a11y on
`/play`; 60 fps during the sunk-ship animation on a 4× CPU-throttled profile; complete
keyboard-only playthrough.

---

## Phase 4 — Multiplayer server (4–5 days)

**Do:**

- `apps/server`: Fastify + `ws`, `RoomActor`, connection auth, room registry.
- `@bs/protocol` Zod schemas as the single validation boundary; `WebSocketTransport`.
- Room codes, invite URL `/room/:code`, lobby UI, presence.
- Reconnect + resume tokens + turn/placement/disconnect timers.
- Rate limiting, message size caps, origin checks
  ([§7.4](./07-testing-security.md#74-input-and-abuse-hardening)).
- Single in-memory room registry on the home-LAN server. Redis and multi-instance routing
  are deliberately deferred: this product runs on one private host, not a public cluster.
- Bind only to the configured private subnet and allow WebSocket origins only from the LAN web
  address; do not port-forward either service.
- The **leak test** ([§7.2](./07-testing-security.md#the-leak-test)) — this phase does
  not ship without it.

**Exit:** two browsers on the configured home LAN complete a game through the local server;
the origin allowlist blocks an unapproved browser origin; Playwright two-context E2E and the
leak test are green. A server restart ends in-memory rooms; persistence is a future LAN feature.

---

## Phase 5 — Polish and resilience (2–3 days)

**Do:**

- Emote set, rematch flow, end-of-game stats and board reveal.
- Connection status HUD (`connecting / reconnecting / opponent offline (1:47)`).
- Error and edge-case UX: room full, room not found, opponent left, server draining.
- WebAudio effects with a mute toggle persisted to `localStorage`.
- PWA: manifest, icons, service worker caching the shell so single-player works offline
  (Workbox via `vite-plugin-pwa`).
- OG image worker for shared invite links.

**Exit:** manual chaos pass — kill Wi-Fi mid-turn, refresh mid-placement, open the same
room in three tabs, join a finished room — with no stuck states.

---

## Phase 6 — Hardening and pre-release (2–3 days)

**Do:**

- Load test with `k6` over WebSocket: 500 concurrent rooms per instance, measure p99
  command→broadcast latency (target < 50 ms server-side) and RSS.
- Security review pass against [§7](./07-testing-security.md); CSP in report-only, then
  enforcing.
- Structured logging (`pino`) with room/player correlation IDs; `/metrics` for Prometheus
  (`rooms_active`, `ws_connections`, `command_latency_ms`, `commands_rejected_total`).
- Sentry for the client, with the game state **redacted** from breadcrumbs (a crash
  report must not leak an in-progress board).
- Manual screen-reader pass (VoiceOver + NVDA).
- Cross-browser matrix: Safari 17+/iOS 17+, Chrome, Firefox, Edge.

**Exit:** load target met; no high/critical findings open; `pnpm audit` clean.

---

## Phase 7 — Home-server release (1 day + soak)

**Do:** install the server and static web build on the private home network, with local uptime
checks on `/healthz`, error-rate and `rooms_active` monitoring. Keep the router closed to the
internet, test from both LAN clients, then soak for a week before changing it.

**Exit:** 7 days at ≥99.5% availability with no P1 incidents.

---

## Post-v1 backlog (explicitly out of scope for v1)

Ordered by value-to-effort, not by how interesting they are:

1. **Spectator mode** — a third connection type receiving a doubly-projected state. Easy
   because the projection layer already exists.
2. **Persistent accounts + ELO** — requires Postgres and auth; the replay format from
   [§3.6](./03-data-models.md#36-persistence) already supports it.
3. **Replays** — `(seed, Command[])` is already a complete recording; needs only a
   player UI.
4. **Rule variants** — salvo, no-touch placement, 8×8 boards. All are `RuleSet` fields;
   the engine already threads `rules` everywhere.
5. **Public matchmaking queue** — a Redis sorted set; the room machinery is unchanged.
6. **Cloudflare Durable Objects migration** — see [ADR-08](./01-tech-stack.md#the-honest-alternative-cloudflare-durable-objects).

**Deliberately never:** free-text chat (moderation cost far exceeds its value here),
real-money anything, and client-side AI in *ranked* modes.
