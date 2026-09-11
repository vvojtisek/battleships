# Battleships

A modern, browser-based Battleship game: single-player against a probability-driven AI,
and real-time two-player matches over shareable room links, with an Apple
Human-Interface-Guidelines-inspired interface.

**Status: playable single-player, LAN server foundations, and gameplay polish are implemented.**
The workspace foundation, dependency-free rules engine, offline browser game, and private-LAN
WebSocket gateway are in place. The complete technical plan lives in
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

For a LAN game, open `/multiplayer`, enter your name, and create a room. The other device opens
the same page, enters its name, sees the available room with its creator's name, and taps **Join
game**. Once they join, both players place and confirm their fleets. The browser refreshes the
available-room list every five seconds; rooms disappear from the list as soon as they have two
players.

During a battle, bundled audio samples play for misses, hits, and sunk ships. Sound begins only
after a player gesture and can be disabled with the **Sound on/off** button; the preference stays
on that device.

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
Ships need one clear cell around them, including diagonally. The alternate touching-ships
variant remains available through the `RuleSet` flag for future room variants.

## License

See [LICENSE](./LICENSE).
