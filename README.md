# Battleships

A modern, browser-based Battleship game: single-player against a probability-driven AI,
and real-time two-player matches over shareable room links, with an Apple
Human-Interface-Guidelines-inspired interface.

**Status: Phase 2 complete.** The workspace foundation, dependency-free rules engine,
and offline single-player browser game are implemented. The complete technical plan lives in
[`docs/architecture/`](./docs/architecture/README.md).

## Development

Requires Node.js 22+ and pnpm 11. Install with `pnpm install`, then run the standard
gates with `pnpm -r typecheck`, `pnpm -r lint`, `pnpm -r test`, and `pnpm -r build`.
The engine additionally provides `pnpm --filter @bs/engine play` for a headless game
and `pnpm --filter @bs/engine bench` for the 10,000-game-per-tier AI regression gate.

### Private LAN test

The project is intentionally configured for private-network testing only. On this PC,
copy `.env.example` to `.env`, then start the server and web app in separate terminals:

```bash
set -a; source .env; set +a; pnpm --filter @bs/server start
set -a; source .env; set +a; pnpm --filter @bs/web dev
```

With this PC at `192.168.0.211`, open `http://192.168.0.211:4173` from another device on
`192.168.0.0/24`. Keep the router/firewall scoped to that subnet; neither service should
be port-forwarded or exposed to the public internet.

## The plan

| # | Document | Contents |
|---|---|---|
| — | [Overview & decision log](./docs/architecture/README.md) | Executive summary, ADRs, repo layout |
| 1 | [Tech stack](./docs/architecture/01-tech-stack.md) | Frontend, backend, transport, hosting, CI/CD — with rejected alternatives |
| 2 | [System architecture](./docs/architecture/02-system-architecture.md) | Room actors, lifecycle state machine, WebSocket protocol, resume |
| 3 | [Data models](./docs/architecture/03-data-models.md) | Bitboards, ship/room schemas, Zod wire contract, projections |
| 4 | [Core algorithms](./docs/architecture/04-core-algorithms.md) | Placement validation, fog of war, hunt/target and density-map AI |
| 5 | [Design system](./docs/architecture/05-design-system.md) | Color, type, materials, grid, spring physics, accessibility |
| 6 | [Roadmap](./docs/architecture/06-roadmap.md) | Phase 0 → production, with exit criteria |
| 7 | [Testing & security](./docs/architecture/07-testing-security.md) | Test pyramid, anti-cheat, hardening, threat model |

## Design in one paragraph

The rules are implemented once, as a dependency-free pure TypeScript package
(`@bs/engine`), and consumed unchanged by the browser, the server, and the tests — so
client and server can never disagree about what is legal. Single-player runs entirely in
the browser (Web Worker, no network, works offline). Multiplayer is server-authoritative:
each room is a single-writer actor holding full-information state, and every outbound
message passes through one projection function that strips what the recipient is not
entitled to see. That single boundary is what makes "open DevTools to see the opponent's
ships" impossible rather than merely inconvenient.

## Game rules

Standard 10×10 Battleship. Fleet: Carrier (5), Battleship (4), Cruiser (3),
Submarine (3), Destroyer (2) — 17 cells total. One shot per turn regardless of outcome.
Ships may touch (standard Milton Bradley rules); the no-touch variant is a `RuleSet` flag.

## License

See [LICENSE](./LICENSE).
