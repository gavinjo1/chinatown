import { readFile } from 'node:fs/promises';
import { createServer, type Server, type ServerResponse } from 'node:http';
import { extname, join, resolve } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';

import type { ClientMessage } from '../src/shared/protocol';
import { RoomManager, send, type Room, type Seat } from './rooms';
import type { Store } from './store';

/** Railway's edge closes idle sockets; ping well inside that window. */
export const HEARTBEAT_MS = 25_000;

const CLIENT_DIR = resolve('dist');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.json': 'application/json',
};

async function serveStatic(path: string, res: ServerResponse): Promise<void> {
  // Unknown paths fall back to index.html so /r/ABCD deep links work — that
  // is also what makes refresh and the back button land back in the room.
  const candidates =
    path === '/' ? ['index.html'] : [path.slice(1), 'index.html'];

  for (const candidate of candidates) {
    const file = join(CLIENT_DIR, candidate);
    if (!file.startsWith(CLIENT_DIR)) break; // path traversal
    try {
      const body = await readFile(file);
      res.writeHead(200, {
        'content-type': MIME[extname(file)] ?? 'application/octet-stream',
      });
      res.end(body);
      return;
    } catch {
      continue;
    }
  }

  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('Not found. Run `npm run build` to produce the client.');
}

export interface App {
  server: Server;
  rooms: RoomManager;
  close: () => Promise<void>;
}

export function createApp(store: Store): App {
  const rooms = new RoomManager(store);

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);

    if (req.method === 'POST' && url.pathname === '/api/room') {
      const room = rooms.create();
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ code: room.code }));
      return;
    }

    if (url.pathname === '/api/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    await serveStatic(url.pathname, res);
  });

  const wss = new WebSocketServer({
    server,
    path: '/ws',
    maxPayload: 256 * 1024,
  });

  interface Context {
    room: Room;
    seat: Seat;
  }
  const contexts = new Map<WebSocket, Context>();
  const alive = new WeakMap<WebSocket, boolean>();

  function handle(socket: WebSocket, message: ClientMessage): void {
    if (message.t === 'ping') return send(socket, { t: 'pong' });

    if (message.t === 'join') {
      const room = rooms.get(String(message.room ?? '').toUpperCase());
      if (!room) return send(socket, { t: 'error', reason: 'No such room.' });

      const result = rooms.join(
        room,
        String(message.name ?? ''),
        socket,
        message.token,
      );
      if ('error' in result) {
        return send(socket, { t: 'error', reason: result.error });
      }

      contexts.set(socket, { room, seat: result.seat });
      send(socket, {
        t: 'joined',
        room: room.code,
        playerId: result.seat.playerId,
        token: result.seat.token,
      });
      rooms.broadcast(room);
      return;
    }

    const context = contexts.get(socket);
    if (!context) {
      return send(socket, { t: 'error', reason: 'Join a room first.' });
    }

    if (message.t === 'start') {
      const refusal = rooms.start(context.room);
      if (refusal) return send(socket, { t: 'error', reason: refusal });
      rooms.broadcast(context.room);
      return;
    }

    if (message.t === 'action') {
      const refusal = rooms.apply(context.room, context.seat, message.action);
      if (refusal) return send(socket, { t: 'error', reason: refusal });
      rooms.broadcast(context.room);
    }
  }

  wss.on('connection', (socket) => {
    alive.set(socket, true);
    socket.on('pong', () => alive.set(socket, true));

    socket.on('message', (raw) => {
      let message: ClientMessage;
      try {
        message = JSON.parse(String(raw));
      } catch {
        return send(socket, { t: 'error', reason: 'Malformed message.' });
      }
      handle(socket, message);
    });

    socket.on('close', () => {
      contexts.delete(socket);
      const room = rooms.detach(socket);
      if (room) rooms.broadcast(room); // others see "reconnecting…"
    });

    socket.on('error', () => socket.close());
  });

  /* Terminate sockets that stopped answering, and keep live ones from being
   * reaped by an intermediate proxy. */
  const heartbeat = setInterval(() => {
    for (const socket of wss.clients) {
      if (alive.get(socket) === false) {
        socket.terminate();
        continue;
      }
      alive.set(socket, false);
      socket.ping();
    }
  }, HEARTBEAT_MS);
  heartbeat.unref?.();

  return {
    server,
    rooms,
    close: () =>
      new Promise<void>((done) => {
        clearInterval(heartbeat);
        for (const socket of wss.clients) socket.terminate();
        wss.close(() => server.close(() => done()));
      }),
  };
}
