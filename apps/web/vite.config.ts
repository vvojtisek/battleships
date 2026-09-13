import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Battleships',
        short_name: 'Battleships',
        description: 'A private-LAN Battleships game with offline single-player.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#10212d',
        theme_color: '#10212d',
        icons: [
          {
            src: 'icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
        ],
      },
      devOptions: { enabled: true, type: 'module' },
    }),
  ],
  server: { host: process.env.HOST ?? '127.0.0.1', port: 4173 },
  preview: { host: process.env.HOST ?? '127.0.0.1', port: 4173 },
});
