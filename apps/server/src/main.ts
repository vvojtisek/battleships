import { buildServer } from './http/server.js';

const port = Number.parseInt(process.env.PORT ?? '3000', 10);
const host = process.env.HOST ?? '127.0.0.1';
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',').filter(Boolean);
const app = await buildServer(undefined, { ...(allowedOrigins ? { allowedOrigins } : {}) });
await app.listen({ host, port });
