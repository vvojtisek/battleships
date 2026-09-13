import { defineConfig, devices } from '@playwright/test';

const host = '127.0.0.1';
const webPort = 4175;
const serverPort = 3100;
const baseURL = `http://${host}:${webPort}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  reporter: process.env.CI ? [['html', { open: 'never' }], ['list']] : 'list',
  use: { baseURL, trace: 'retain-on-failure' },
  webServer: [
    {
      command: 'pnpm --filter @bs/server start',
      url: `http://${host}:${serverPort}/healthz`,
      reuseExistingServer: false,
      env: {
        HOST: host,
        PORT: String(serverPort),
        ALLOWED_ORIGINS: baseURL,
        PROFILE_STORE_PATH: '/tmp/battleships-e2e-players.json',
      },
    },
    {
      command: `pnpm --filter @bs/web exec vite --host ${host} --port ${webPort}`,
      url: baseURL,
      reuseExistingServer: false,
      env: { VITE_SERVER_URL: `http://${host}:${serverPort}` },
    },
  ],
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
