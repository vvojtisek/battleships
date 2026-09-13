import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.{ts,tsx}', 'apps/*/test/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      include: [
        'packages/engine/src/**/*.ts',
        'apps/server/src/**/*.ts',
        'apps/web/src/**/*.{ts,tsx}',
      ],
      exclude: [
        '**/index.ts',
        '**/main.ts',
        'apps/web/src/main.tsx',
        'apps/web/src/game/game.worker.ts',
        'apps/web/src/vite-env.d.ts',
      ],
      thresholds: {
        'packages/engine/src/**': { statements: 100, branches: 100, functions: 100, lines: 100 },
        'apps/server/src/**': { statements: 80, branches: 75, functions: 85, lines: 80 },
        'apps/web/src/**': { statements: 25, branches: 60, functions: 35, lines: 25 },
        'apps/web/src/components/{AppNav,Battle,Board,FleetPlacement,MainMenu,MatchFrame}.tsx': {
          statements: 65,
          branches: 50,
          functions: 20,
          lines: 65,
        },
        'apps/web/src/profile/**': { statements: 65, branches: 65, functions: 100, lines: 65 },
      },
    },
  },
});
