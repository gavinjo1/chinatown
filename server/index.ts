import { resolve } from 'node:path';

import { createApp } from './app';
import { FileStore } from './store';

const PORT = Number(process.env.PORT ?? 8787);
const DATA_DIR = process.env.DATA_DIR ?? resolve('.data/rooms');

const app = createApp(new FileStore(DATA_DIR));

// Rooms are rebuilt before the first socket lands, so a redeploy mid-game is
// survivable: players reconnect with the tokens they already hold.
const restored = await app.rooms.restore();

app.server.listen(PORT, () => {
  console.log(`chinatown on :${PORT} — ${restored} room(s) restored`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    app.close().then(() => process.exit(0));
  });
}
