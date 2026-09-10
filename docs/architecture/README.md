# Battleship — Technical Implementation & Architecture Plan

Status: **In implementation** · Version: 1.1 · Target repo: `vvojtisek/battleships`

Deployment decision: multiplayer is private-home-LAN only (`192.168.0.0/24`), hosted on one
machine. Public hosting, Fly.io, Cloudflare, Redis, and port forwarding are out of scope.

This directory is the authoritative implementation plan for a browser-based Battleship
game with single-player (AI) and real-time two-player modes, built to an Apple
Human Interface Guidelines aesthetic.

## Sections

| # | Document | Contents |
|---|---|---|
| 1 | [01-tech-stack.md](./01-tech-stack.md) | Frontend, backend, real-time protocol, hosting, CI/CD — with rejected alternatives |
| 2 | [02-system-architecture.md](./02-system-architecture.md) | Process topology, room lifecycle state machine, authoritative validation, WebSocket event protocol |
| 3 | [03-data-models.md](./03-data-models.md) | Bitboard representation, ship/player/room schemas, wire DTOs, Zod contracts |
| 4 | [04-core-algorithms.md](./04-core-algorithms.md) | Placement validation, fog-of-war projection, AI (parity hunt + probability density) |
| 5 | [05-design-system.md](./05-design-system.md) | Color, typography, materials, grid specs, motion physics, accessibility |
| 6 | [06-roadmap.md](./06-roadmap.md) | Phase 0 → production, with exit criteria per phase |
| 7 | [07-testing-security.md](./07-testing-security.md) | Test strategy, anti-cheat, input hardening, threat model |

## Executive summary

**The single most important architectural decision is that the rules engine is one
pure TypeScript package (`@bs/engine`) with zero dependencies, consumed unchanged by
three callers:** the browser (optimistic UI + the entire single-player game), the
Node server (authoritative multiplayer validation), and the test suite (property-based
and replay tests). No rule is expressed twice, so client and server can never disagree
about legality.

Everything else follows from that:

- **Single-player runs entirely in the browser.** No server, no network, no room. The
  AI is a function in `@bs/engine` executed in a Web Worker. The game is playable
  offline and ships as a static bundle.
- **Multiplayer is server-authoritative with a strict projection boundary.** The
  server holds the full board state; every outbound message passes through
  `project(state, viewerId)`, which is the *only* place opponent data can be stripped.
  One enforcement point means one place to test (see [§7](./07-testing-security.md#the-leak-test)).
- **Rooms are single-writer.** A room lives in exactly one process, mutated by a
  serialized command queue. This eliminates the entire class of concurrent-shot race
  conditions without distributed locking.

## Decision log (ADR summary)

| ID | Decision | Chosen | Rejected | Rationale |
|---|---|---|---|---|
| ADR-01 | Frontend framework | Vite + React 19 SPA | Next.js | No SSR-worthy content; Next's server runtime cannot hold the WebSocket state anyway. See [§1.1](./01-tech-stack.md#11-frontend-runtime) |
| ADR-02 | Client state | Zustand + shared reducer | Redux Toolkit, Jotai, XState | Game state is one coherent machine, not a graph of independent atoms |
| ADR-03 | Styling | Tailwind CSS v4 (CSS-first `@theme`) | CSS Modules, vanilla-extract, Tailwind v3 | Design tokens live in CSS custom properties, readable by both Tailwind and raw CSS/WAAPI animations |
| ADR-04 | Animation | Motion (`motion`) for layout, CSS/WAAPI for the 100-cell grid | Motion everywhere, GSAP | 100 `<motion.div>` cells is a measurable main-thread cost for zero benefit |
| ADR-05 | Backend language | Node 22 + TypeScript | Go, Python/FastAPI | Sharing `@bs/engine` verbatim beats raw throughput at this workload (~2 KB/s per room) |
| ADR-06 | Transport | Raw `ws` + typed envelope | Socket.io | We need resumable, sequence-numbered, at-least-once delivery. Socket.io does not provide that; its rooms/fallbacks are overhead we do not use |
| ADR-07 | State store | In-process `Map` on one LAN host | Redis | A single local server needs no directory or distributed coordination; restarting it ends active rooms |
| ADR-08 | Hosting (server) | Private home-LAN Node host | Public cloud, serverless, Cloudflare Durable Objects | The game is intentionally reachable only from the two home subnets, with no public ingress |
| ADR-09 | Chat | Fixed emote set, no free text | Free-text chat | Removes the entire moderation and XSS surface for near-zero UX loss |

## Repository layout

```
battleships/
├── apps/
│   ├── web/                  # Vite React SPA (static bundle)
│   └── server/               # Node WebSocket + HTTP server
├── packages/
│   ├── engine/               # Pure rules + AI. Zero runtime deps. 100% covered.
│   ├── protocol/             # Zod schemas + inferred TS types = the wire contract
│   └── ui/                   # Design-system primitives (Button, Card, Sheet, Grid)
├── docs/architecture/        # This plan
└── .github/workflows/        # CI/CD
```

Tooling: **pnpm workspaces** (strict, non-hoisted `node_modules` catches undeclared
imports that would break the server build), **TypeScript project references**,
**Vitest**, **Playwright**, **ESLint 9 flat config**, **Prettier**.
