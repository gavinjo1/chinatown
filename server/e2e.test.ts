import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { WebSocket } from 'ws';

import { leaksMoney } from '../src/engine/view';
import type { ClientMessage, ServerMessage } from '../src/shared/protocol';
import { createApp, type App } from './app';
import { MemoryStore } from './store';

/* End-to-end over real sockets. The unit tests cover the room logic; these
 * cover the wiring, which is where "refreshing kicked me out" actually
 * lives. */

interface Client {
  socket: WebSocket;
  frames: ServerMessage[];
  send: (message: ClientMessage) => void;
  wait: <T extends ServerMessage['t']>(
    t: T,
  ) => Promise<Extract<ServerMessage, { t: T }>>;
  clear: () => void;
  kill: () => void;
}

async function connect(port: number): Promise<Client> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const frames: ServerMessage[] = [];
  socket.on('message', (raw) => frames.push(JSON.parse(String(raw))));
  await once(socket, 'open');

  return {
    socket,
    frames,
    send: (message) => socket.send(JSON.stringify(message)),
    clear: () => void frames.splice(0, frames.length),
    kill: () => socket.terminate(), // an abrupt drop, like closing a laptop
    async wait(t) {
      for (let i = 0; i < 200; i++) {
        const found = frames.find((f) => f.t === t);
        if (found) return found as never;
        await new Promise((r) => setTimeout(r, 10));
      }
      throw new Error(`timed out waiting for "${t}"`);
    },
  };
}

async function boot(): Promise<{ app: App; port: number; store: MemoryStore }> {
  const store = new MemoryStore();
  const app = createApp(store);
  app.server.listen(0);
  await once(app.server, 'listening');
  return { app, port: (app.server.address() as AddressInfo).port, store };
}

async function table() {
  const { app, port, store } = await boot();
  const response = await fetch(`http://127.0.0.1:${port}/api/room`, {
    method: 'POST',
  });
  const { code } = (await response.json()) as { code: string };

  const clients: Client[] = [];
  const tokens: string[] = [];
  for (const name of ['Ann', 'Ben', 'Cai']) {
    const client = await connect(port);
    client.send({ t: 'join', room: code, name });
    tokens.push((await client.wait('joined')).token);
    clients.push(client);
  }
  // Drop the join-time broadcasts so a later wait() cannot match a stale one.
  for (const client of clients) client.clear();
  return { app, port, store, code, clients, tokens };
}

test('a refresh keeps your seat', async (t) => {
  const { app, port, code, clients, tokens } = await table();
  t.after(() => app.close());

  clients[0].send({ t: 'start' });
  const before = await clients[1].wait('state');
  assert.equal(before.started, true);
  assert.equal(before.presence.length, 3);

  // Ann's laptop lid closes: the socket dies without a clean close.
  clients[1].clear();
  clients[0].kill();

  const dropped = await clients[1].wait('state');
  const ann = dropped.presence.find((p) => p.playerId === 'p0')!;
  assert.equal(ann.connected, false, 'others see her as reconnecting');
  assert.equal(dropped.presence.length, 3, 'her seat is still there');

  // She reopens the page. New socket, same token from localStorage.
  const reopened = await connect(port);
  reopened.send({ t: 'join', room: code, name: 'Ann', token: tokens[0] });
  const rejoined = await reopened.wait('joined');
  assert.equal(rejoined.playerId, 'p0', 'same seat');

  const after = await reopened.wait('state');
  assert.equal(after.presence.length, 3, 'no duplicate seat appeared');
  assert.ok(
    after.presence.every((p) => p.connected),
    'everyone is back online',
  );
  assert.ok(after.state, 'and she gets the live game back');
  assert.equal(after.state.round, 1);
  reopened.socket.close();
});

test('the wire never carries another player’s money', async (t) => {
  const { app, clients } = await table();
  t.after(() => app.close());

  clients[0].send({ t: 'start' });
  const view = (await clients[1].wait('state')).state!;
  assert.equal(leaksMoney(view, 'p1'), false);
  assert.equal(view.players.find((p) => p.id === 'p1')!.money, 50);
  assert.equal(view.players.find((p) => p.id === 'p0')!.money, undefined);
});

test('you cannot act for another player over the wire', async (t) => {
  const { app, clients } = await table();
  t.after(() => app.close());

  clients[0].send({ t: 'start' });
  await clients[0].wait('state');
  clients[0].clear();

  // Ben's client forges an action claiming to be Cai.
  clients[1].clear();
  clients[1].send({
    t: 'action',
    action: { type: 'KEEP_LOTS', player: 'p2', lots: [1, 2, 3, 4, 5] },
  });

  const refusal = await clients[1].wait('error');
  assert.match(refusal.reason, /cannot act for another player/i);
});

test('a room survives a restart and players walk back in', async (t) => {
  const { app, store, code, tokens } = await table();
  const first = app.rooms.get(code)!;
  app.rooms.start(first);
  await app.close();

  // Redeploy: new process, same store.
  const second = createApp(store);
  t.after(() => second.close());
  assert.equal(await second.rooms.restore(), 1);
  second.server.listen(0);
  await once(second.server, 'listening');
  const port = (second.server.address() as AddressInfo).port;

  const returning = await connect(port);
  returning.send({ t: 'join', room: code, name: 'Ann', token: tokens[0] });
  assert.equal((await returning.wait('joined')).playerId, 'p0');

  const state = await returning.wait('state');
  assert.equal(state.started, true);
  assert.equal(state.state!.players.length, 3);
  returning.socket.close();
});

test('the server answers a ping, so proxies keep the socket open', async (t) => {
  const { app, port } = await boot();
  t.after(() => app.close());

  const client = await connect(port);
  client.send({ t: 'ping' });
  await client.wait('pong');
  client.socket.close();
});
