# 1. Tech Stack Selection & Justification

Selection criteria, in priority order:

1. **One rules implementation.** Any stack that forces the rules to be written twice
   (once in the client language, once in the server language) is disqualified before
   performance is even considered.
2. **Long-lived stateful connections.** The workload is a persistent socket per player,
   not a request/response burst.
3. **Frame budget.** The board is 100 interactive cells with blur-backed materials. The
   stack must not force a component-per-cell reconciliation on every shot.
4. **Ejectability.** No dependency should be load-bearing enough that removing it is a
   rewrite.

---

## 1.1 Frontend runtime

**Chosen: Vite 7 + React 19 + TypeScript 5.9, as a static SPA.**

Rationale:

- The application has exactly one route worth server-rendering — the marketing/landing
  page. Everything else (`/play`, `/room/:code`) is behind an interaction and renders
  from client state driven by a socket. SSR buys nothing there.
- Next.js's value proposition (RSC, server actions, streaming data fetching) does not
  apply to a game whose state arrives over a WebSocket. Meanwhile its server runtime
  **cannot** host our authoritative game state: Next route handlers are request-scoped
  and, on Vercel, run on a serverless model that terminates between invocations.
  Adopting Next would still require a separate socket server — so we would carry two
  server runtimes instead of one.
- Vite gives sub-100 ms HMR against the engine package via workspace linking, which
  matters because most iteration is on `@bs/engine` + the grid renderer.

**The one thing Next.js would give us that we must replace:** per-room Open Graph
previews for shared invite links. Replacement: a 30-line edge function (Cloudflare
Worker / Vercel Edge) at `/room/:code` that returns a static HTML shell with
`og:title`/`og:image` pointing at a pre-rendered static image, then hands off to the
SPA. Cost: one file. This is strictly cheaper than adopting a framework for it.

**Rejected:** SvelteKit / SolidStart (smaller, faster, but the React ecosystem for the
specific libraries below — Motion, Radix primitives, Playwright component testing — is
materially deeper); Vue (no technical objection, purely ecosystem depth for HIG-style
primitives).

### State management — ADR-02

**Chosen: Zustand for the store shell, with the actual transitions delegated to a pure
reducer from `@bs/engine`.**

```ts
// apps/web/src/store/game.ts
import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { reduce, type GameState, type Command } from '@bs/engine';

interface GameStore {
  state: GameState;
  /** Applies a command locally. Returns the rejection reason if illegal. */
  dispatch: (cmd: Command) => { ok: true } | { ok: false; reason: string };
  /** Replaces local state with an authoritative server snapshot. */
  reconcile: (snapshot: GameState) => void;
}

export const useGame = create<GameStore>()(
  subscribeWithSelector((set, get) => ({
    state: initialState(),
    dispatch: (cmd) => {
      const result = reduce(get().state, cmd);
      if (!result.ok) return { ok: false, reason: result.reason };
      set({ state: result.state });
      return { ok: true };
    },
    reconcile: (snapshot) => set({ state: snapshot }),
  })),
);
```

Why Zustand specifically:

- **`subscribeWithSelector` gives us imperative, non-rendering subscriptions.** Cell
  hover, drag-preview of a ship, and the shot-impact animation must run at 60 fps
  without re-rendering 100 React components. We subscribe outside React and mutate
  DOM/CSS variables directly. This is the deciding factor.
- No provider, no context — the store is importable from the Web Worker bridge and
  from Playwright test hooks.
- ~1.2 KB gzipped.

**Rejected — Jotai:** atoms model *independent* pieces of state. Battleship state is
one interdependent machine where a single shot mutates the board, turn owner, ship
health, and phase atomically. Modelling that as atoms means either one giant atom
(Zustand with extra steps) or derived-atom fan-out with ordering hazards.

**Rejected — XState:** the honest case *for* it is real; the lifecycle genuinely is a
state machine and XState would give visualization and exhaustive transition typing.
Rejected because (a) the same machine must run on the server, and serializing/rehydrating
XState actor state across the wire and into Redis snapshots is meaningfully more
complex than serializing a plain discriminated union; (b) ~14 KB for guarantees a
`switch` on a tagged union plus `satisfies` already provides. Revisit if the lifecycle
grows tournament/spectator branches.

### Styling — ADR-03

**Chosen: Tailwind CSS v4.** The v4 CSS-first configuration is the reason:

```css
/* apps/web/src/styles/theme.css */
@import "tailwindcss";

@theme {
  --color-accent: #007aff;
  --radius-card: 20px;
  --ease-hig: cubic-bezier(0.25, 0.1, 0.25, 1);
}
```

Tokens become real CSS custom properties, which means the *same* token is readable by
Tailwind utilities, hand-written CSS, and the Web Animations API calls we use for grid
cells. With v3's JS config, WAAPI code would have had to import the resolved config at
runtime or duplicate values. Full token set in [§5](./05-design-system.md).

Oxide (the v4 Rust engine) also removes the need for `content` globbing config, which
was a recurring source of "class silently missing in prod" bugs with dynamic class names.

### Animation — ADR-04

**Chosen: `motion` (the Motion library, formerly Framer Motion) for layout/route/modal
transitions; CSS transitions + WAAPI for the grid.**

The distinction is load-bearing:

| Surface | Technique | Why |
|---|---|---|
| Route + phase transitions, sheets, toasts | `motion/react` (`AnimatePresence`, `layout`) | Enter/exit and shared-layout animation are genuinely hard by hand |
| Ship drag & drop during placement | Motion `drag` with `dragConstraints` + snap-to-grid in `onDrag` | Pointer capture, momentum, and constraints for free |
| 100 grid cells (hover, peg drop, sunk ripple) | CSS custom property + `element.animate()` | 100 `<motion.div>`s means 100 subscriptions and 100 style objects reconciled per frame. Measured on a 2019 MacBook Air this is the difference between 60 fps and ~40 fps during the sunk-ship ripple |

Grid cells are plain `<button>` elements. Impact animation is a one-shot WAAPI call on
the specific cell that changed, triggered from the Zustand subscription — zero React
renders per shot.

### Other frontend dependencies

| Concern | Package | Note |
|---|---|---|
| Routing | `react-router` v7 (declarative mode) | 3 routes; a full framework router is unwarranted |
| Accessible primitives | Radix UI (`@radix-ui/react-dialog`, `-switch`, `-toast`) | Unstyled, WAI-ARIA compliant; we skin them to HIG |
| Validation | `zod` v4 | Shared with the server via `@bs/protocol` |
| Sound | Native `AudioContext`, no library | ~6 short buffers; Howler is 30 KB for nothing |
| Icons | `lucide-react`, tree-shaken | SF Symbols are not licensed for web use — see [§5.2](./05-design-system.md#52-typography) |

---

## 1.2 Backend runtime — ADR-05

**Chosen: Node.js 22 LTS + TypeScript, Fastify for HTTP, `ws` for WebSocket.**

The decisive argument is code sharing. In Go or Python, `@bs/engine` would have to be
reimplemented, and the two implementations would drift — the client would allow a
placement the server rejects, or vice versa. Every such divergence is a user-visible
bug in the most trust-sensitive part of the product.

The performance counter-argument does not survive arithmetic. Per active room:

- ~2 messages/second at human play speed (shots + acks).
- Envelope size ~200 bytes JSON.
- The heaviest server-side computation is placement validation at ~10 bitwise ops.

A single Node process comfortably handles **10,000+ concurrent rooms** — the binding
constraint is socket memory (~30–60 KB/connection with `ws`), not CPU. Go's advantage
would be real at 10⁵–10⁶ connections; we are three orders of magnitude away.

- **Fastify** over Express: native schema-based serialization, ~2× throughput, and
  first-class TypeScript. Used only for `/healthz`, `/api/rooms`, and metrics — the
  game traffic never touches HTTP after the upgrade.
- **`ws`** over `uWebSockets.js`: `uWS` is ~4× faster, but is a native addon with a
  non-standard API and its own HTTP server. At our message rate the difference is
  unmeasurable, and `ws` keeps deployment to a plain `node:22-slim` image. The
  transport is behind a `Transport` interface (see [§2.4](./02-system-architecture.md#24-transport-abstraction)),
  so swapping to `uWS` is a single-file change if load ever justifies it.

**Rejected — Go:** would win on connection density and memory, loses on the shared
engine. If this were a 100k-CCU product, the correct answer flips: implement the engine
in Go and compile it to WASM for the client, keeping a single implementation in the
other direction.

**Rejected — Python/FastAPI:** the GIL plus per-connection asyncio overhead makes it the
weakest of the three for many idle sockets, and it shares no code with the client.

---

## 1.3 Real-time protocol — ADR-06

**Chosen: raw WebSocket (`wss://`) carrying a versioned, sequence-numbered JSON
envelope. No Socket.io.**

Socket.io's headline features map poorly here:

| Socket.io feature | Our need |
|---|---|
| HTTP long-polling fallback | Irrelevant. WebSocket support is universal in every browser that can run this game; a client that cannot open a socket gets the offline single-player mode |
| Rooms / broadcast | Two players. A `Set<Connection>` on the room object |
| Redis adapter for horizontal scaling | We route by room, not broadcast across instances (ADR-07). The adapter solves a problem we designed away |
| Automatic reconnection | Reconnection is the easy half. The hard half is **state resumption** — replaying missed events after a 20-second tunnel outage — which Socket.io does not do |

What we need instead, and must build regardless of library choice:

- Monotonic `seq` per room, so a resuming client says "I have through 41" and receives
  either the delta or a full snapshot.
- Client-generated `cmdId` for idempotency, so a retried `turn.fire` after an ambiguous
  disconnect does not fire twice.
- Resume tokens with a grace window, so a refresh does not forfeit the game.

Given that we build all of it, Socket.io contributes ~40 KB of client bundle and a
protocol layer we would have to reason around. Full protocol in
[§2.5](./02-system-architecture.md#25-websocket-event-protocol).

**Encoding: JSON for v1.** Envelopes are ~200 bytes; MessagePack or a custom binary
frame would save ~40% of a rounding error while destroying `wscat`/DevTools
debuggability. The envelope carries a `v` field so a binary codec can be negotiated later.

**Rejected — WebTransport/WebRTC DataChannel:** unordered/unreliable delivery is
actively wrong for a turn-based game; NAT traversal and TURN costs for zero latency
benefit at 2 messages/second.

**Rejected — Server-Sent Events + POST:** works, but two transports to keep in sync,
and SSE has a per-domain connection cap under HTTP/1.1.

---

## 1.4 Deployment topology — ADR-08

| Component | Target | Notes |
|---|---|---|
| `apps/web` | Vite dev server during development; static build on the home server later | Bind only to the LAN address |
| `apps/server` | One Node process on the home-LAN PC/server | `HOST=0.0.0.0`, with `ALLOWED_ORIGINS` limited to the LAN web address |
| State | In-process room registry | No Redis, no multi-instance routing, no public ingress |

The router/firewall must keep ports 3000 and 4173 inside `192.168.0.0/24`; do not
port-forward them. A server restart ends active in-memory rooms, which is acceptable for this
private-game scope. The engine and protocol remain portable if persistence is ever needed.

---

## 1.5 CI/CD

```yaml
# .github/workflows/ci.yml
name: CI
on:
  push: { branches: [main] }
  pull_request:

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm -r typecheck          # tsc --build, project references
      - run: pnpm -r lint
      - run: pnpm -r test -- --coverage
      - name: Engine coverage gate
        run: pnpm --filter @bs/engine test -- --coverage.thresholds.100
      - run: pnpm -r build

  e2e:
    runs-on: ubuntu-latest
    needs: verify
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec playwright install --with-deps chromium
      - run: pnpm test:e2e               # boots server + web, two browser contexts
      - uses: actions/upload-artifact@v4
        if: failure()
        with: { name: playwright-report, path: playwright-report/ }
```

Deploy workflow (`deploy.yml`, on `main` after CI green):

1. `flyctl deploy --strategy=rolling` for `apps/server`. Rolling, not blue-green:
   in-flight games live in process memory, so we drain gracefully — on `SIGTERM` the
   server stops accepting new rooms, emits `server.draining` to connected clients (which
   triggers a client-side reconnect to a healthy machine using its resume token), and
   exits after the last room finishes or 90 s, whichever is first.
2. `wrangler pages deploy` for `apps/web`.
3. PR previews: Cloudflare Pages preview URL + an ephemeral Fly app per PR label
   `preview`, torn down on close.

**Release gates:** engine coverage 100% (statements+branches), no `any` in
`packages/**`, bundle budget enforced by `size-limit` (initial JS ≤ 180 KB gzipped),
Lighthouse CI performance ≥ 95 on the play route.
