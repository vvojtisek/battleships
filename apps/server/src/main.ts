import { buildServer } from './http/server.js';
import { ProfileStore } from './profile/ProfileStore.js';

const port = Number.parseInt(process.env.PORT ?? '3000', 10);
const host = process.env.HOST ?? '127.0.0.1';
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',').filter(Boolean);
const partyAdminPin = process.env.PARTY_ADMIN_PIN;
const profileStorePath = process.env.PROFILE_STORE_PATH;
const app = await buildServer(undefined, {
  ...(allowedOrigins ? { allowedOrigins } : {}),
  ...(partyAdminPin ? { partyAdminPin } : {}),
  ...(profileStorePath ? { profileStore: new ProfileStore(profileStorePath) } : {}),
});
await app.listen({ host, port });
