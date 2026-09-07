import assert from 'node:assert/strict';
import test from 'node:test';
import type { WebSocket } from 'ws';

import type { GameView } from '../src/engine/view';
import { leaksMoney } from '../src/engine/view';
import type { ServerMessage } from '../src/shared/protocol';
import { RoomManager, authorize } from './rooms';
import { MemoryStore } from './store';

/** Just enough WebSocket to record what the server sends. */
function fakeSocket() {
  const frames: ServerMessage[] = [];
  const socket = {
    readyState: 1,
    send: (raw: string) => frames.push(JSON.parse(raw)),
    close: () => {},
  } as unknown as WebSocket;
  return { socket, frames };
}

function lastState(frames: ServerMessage[]) {
  const states = frames.filter((f) => f.t === 'state');
  return states[states.length - 1] as Extract<ServerMessage, { t: 'state' }>;
}

async function seatedRoom() {
  const store = new MemoryStore();
  const rooms = new RoomManager(store);
  const room = rooms.create();
  const sockets = ['Ann', 'Ben', 'Cai'].map((name) => {
    const fake = fakeSocket();
    const result = rooms.join(room, name, fake.socket);
    assert.ok('seat' in result);
    return { ...fake, seat: result.seat };
  });
  return { store, rooms, room, sockets };
}

/* ---------- authorisation --------------------------------------------- */

test('a player cannot act for someone else', () => {
  assert.equal(
    authorize({ type: 'PLACE_TILE', player: 'p0', tile: 't0', lot: 1 }, 'p0'),
    null,
  );
  assert.match(
    authorize({ type: 'PLACE_TILE', player: 'p1', tile: 't0', lot: 1 }, 'p0') ??
      '',
    /cannot act for another player/i,
  );
});

test('confirming a deal is authorised per player', () => {
  assert.equal(
    authorize({ type: 'SET_CONFIRM', dealId: 1, player: 'p0', confirmed: true }, 'p0'),
    null,
  );
  assert.ok(
    authorize({ type: 'SET_CONFIRM', dealId: 1, player: 'p1', confirmed: true }, 'p0'),
    'forging another player’s confirmation must be refused',
  );
});

test('anyone may edit a deal, because execution still needs consent', () => {
  // Proposing a transfer out of someone else's hand is harmless: it cannot
  // move anything until that player sends their own SET_CONFIRM.
  assert.equal(
    authorize(
      {
        type: 'ADD_DEAL_ITEM',
        dealId: 1,
        item: { kind: 'tile', from: 'p1', to: 'p0', tile: 't5' },
      },
      'p0',
    ),
    null,
  );
});

test('hotseat-only actions are refused online', () => {
  assert.ok(authorize({ type: 'SET_ACTING_PLAYER', index: 2 }, 'p0'));
  assert.ok(authorize({ type: 'END_NEGOTIATION' }, 'p0'));
  assert.ok(authorize({ type: 'END_BUILD' }, 'p0'));
});

/* ---------- redaction -------------------------------------------------- */

test('a broadcast never carries another player’s money', async () => {
  const { rooms, room, sockets } = await seatedRoom();
  assert.equal(rooms.start(room), null);
  rooms.broadcast(room);

  for (const { frames, seat } of sockets) {
    const view = lastState(frames).state as GameView;
    assert.ok(view, 'every seat receives a state');
    assert.equal(
      leaksMoney(view, seat.playerId),
      false,
      `${seat.playerId} was sent someone else's balance`,
    );
    // Their own balance is present, so the UI can still show it.
    const self = view.players.find((p) => p.id === seat.playerId)!;
    assert.equal(self.money, 50);
  }
});

test('everything except money stays public', async () => {
  const { rooms, room, sockets } = await seatedRoom();
  rooms.start(room);
  rooms.broadcast(room);

  const view = lastState(sockets[0].frames).state as GameView;
  for (const player of view.players) {
    // Buildings drawn and tiles held are revealed by the rules.
    assert.ok(Array.isArray(player.pendingLots));
    assert.ok(Array.isArray(player.tiles));
  }
});

/* ---------- seats survive the socket ----------------------------------- */

test('reconnecting with a token reclaims the same seat', async () => {
  const { rooms, room, sockets } = await seatedRoom();
  const ann = sockets[0];
  rooms.start(room);

  // Refresh: the old socket dies, a brand new one presents the token.
  rooms.detach(ann.socket);
  assert.equal(room.seats[0].connected, false);
  assert.equal(room.seats.length, 3, 'the seat is not freed');

  const revived = fakeSocket();
  const result = rooms.join(room, 'Ann', revived.socket, ann.seat.token);
  assert.ok('seat' in result);
  assert.equal(result.seat.playerId, 'p0', 'same seat, same player id');
  assert.equal(room.seats.length, 3, 'no duplicate seat was created');
  assert.equal(room.seats[0].connected, true);
});

test('a stranger cannot join a game in progress', async () => {
  const { rooms, room } = await seatedRoom();
  rooms.start(room);

  const stranger = fakeSocket();
  const result = rooms.join(room, 'Dee', stranger.socket);
  assert.ok('error' in result);
  assert.match(result.error, /already started/i);
});

test('a room holds at most five players', async () => {
  const { rooms, room } = await seatedRoom();
  for (const name of ['Dee', 'Eve']) {
    assert.ok('seat' in rooms.join(room, name, fakeSocket().socket));
  }
  const sixth = rooms.join(room, 'Fay', fakeSocket().socket);
  assert.ok('error' in sixth);
});

test('a game cannot start below three players', async () => {
  const store = new MemoryStore();
  const rooms = new RoomManager(store);
  const room = rooms.create();
  rooms.join(room, 'Ann', fakeSocket().socket);
  assert.match(rooms.start(room) ?? '', /at least 3/i);
});

/* ---------- surviving a restart ---------------------------------------- */

test('rooms and tokens survive a server restart', async () => {
  const { store, rooms, room, sockets } = await seatedRoom();
  rooms.start(room);
  rooms.apply(room, sockets[0].seat, {
    type: 'KEEP_LOTS',
    player: 'p0',
    lots: room.state!.players[0].pendingLots.slice(0, 5),
  });

  // A redeploy: brand new process, same store.
  const revivedManager = new RoomManager(store);
  assert.equal(await revivedManager.restore(), 1);

  const revivedRoom = revivedManager.get(room.code)!;
  assert.ok(revivedRoom, 'the room came back');
  assert.equal(revivedRoom.started, true);
  assert.equal(revivedRoom.seats.length, 3);
  assert.ok(
    revivedRoom.seats.every((s) => !s.connected),
    'everyone starts disconnected after a restart',
  );
  // The kept buildings are still there.
  assert.equal(revivedRoom.state!.players[0].lots.length, 5);

  // And the token a player is still holding gets them back in.
  const back = revivedManager.join(
    revivedRoom,
    'Ann',
    fakeSocket().socket,
    sockets[0].seat.token,
  );
  assert.ok('seat' in back);
  assert.equal(back.seat.playerId, 'p0');
});

test('an action from an unstarted room is refused', async () => {
  const { rooms, room, sockets } = await seatedRoom();
  const refusal = rooms.apply(room, sockets[0].seat, { type: 'CREATE_DEAL' });
  assert.match(refusal ?? '', /not started/i);
});

test('abandoned rooms are swept on restore', async () => {
  const store = new MemoryStore();
  const rooms = new RoomManager(store);
  const room = rooms.create();
  rooms.join(room, 'Ann', fakeSocket().socket);
  await new Promise((r) => setTimeout(r, 0)); // let the persist settle

  // Two days later, nobody came back.
  store.rooms.get(room.code)!.updatedAt = Date.now() - 48 * 60 * 60 * 1000;

  const afterRestart = new RoomManager(store);
  assert.equal(await afterRestart.restore(), 0, 'not reloaded');
  assert.equal(store.rooms.size, 0, 'and cleaned off disk');
});

test('a room still in use is kept on restore', async () => {
  const { store, room } = await seatedRoom();
  await new Promise((r) => setTimeout(r, 0));

  const afterRestart = new RoomManager(store);
  assert.equal(await afterRestart.restore(), 1);
  assert.ok(afterRestart.get(room.code));
});
