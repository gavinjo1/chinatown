import { randomBytes } from 'node:crypto';
import type { WebSocket } from 'ws';

import { createGame, reduce, type Action } from '../src/engine/game';
import type { GameState } from '../src/engine/types';
import { viewFor } from '../src/engine/view';
import {
  MAX_PLAYERS,
  MIN_PLAYERS,
  isRoomCode,
  makeRoomCode,
  type Presence,
  type ServerMessage,
} from '../src/shared/protocol';
import type { Store, StoredRoom } from './store';

export interface Seat {
  playerId: string;
  /** The player's real identity. Survives refresh; the socket does not. */
  token: string;
  name: string;
  connected: boolean;
  socket: WebSocket | null;
}

export interface Room {
  code: string;
  seats: Seat[];
  state: GameState | null;
  started: boolean;
  seq: number;
}

/* ---------- authorisation ---------------------------------------------
 * Never trust `action.player`. A client can send any JSON it likes, so every
 * action is checked against the seat that owns the socket it arrived on. */

export function authorize(action: Action, playerId: string): string | null {
  switch (action.type) {
    // Acting for yourself only.
    case 'KEEP_LOTS':
    case 'PLACE_TILE':
    case 'SET_CONFIRM':
    case 'SET_READY':
      return action.player === playerId
        ? null
        : 'You cannot act for another player.';

    // Anyone at the table may edit any deal. That is safe because a deal only
    // executes once every involved party has sent their own SET_CONFIRM, and
    // those are authorised above — so proposing a transfer out of someone
    // else's hand can never move anything without their consent.
    case 'CREATE_DEAL':
    case 'ADD_DEAL_ITEM':
    case 'REMOVE_DEAL_ITEM':
    case 'ADD_PROMISE':
    case 'CANCEL_DEAL':
    case 'START_ROUND':
      return null;

    // Hotseat-only affordances.
    case 'SET_ACTING_PLAYER':
      return 'Each client acts as itself online.';
    case 'END_NEGOTIATION':
    case 'END_BUILD':
      return 'Phases end when every player is ready.';

    default:
      return 'Unknown action.';
  }
}

const token = () => randomBytes(24).toString('base64url');

export class RoomManager {
  private rooms = new Map<string, Room>();
  private store: Store;

  constructor(store: Store) {
    this.store = store;
  }

  /** Rebuild rooms from disk after a restart. Sockets start disconnected;
   *  players reclaim their seats with the tokens they already hold.
   *
   *  Rooms older than `maxAgeMs` are dropped, so abandoned games do not
   *  accumulate on disk forever. */
  async restore(maxAgeMs = 24 * 60 * 60 * 1000): Promise<number> {
    const cutoff = Date.now() - maxAgeMs;

    for (const stored of await this.store.load()) {
      if (stored.updatedAt < cutoff) {
        void this.store.remove(stored.code);
        continue;
      }
      this.rooms.set(stored.code, {
        code: stored.code,
        seats: stored.seats.map((seat) => ({
          ...seat,
          connected: false,
          socket: null,
        })),
        state: stored.state,
        started: stored.started,
        seq: 0,
      });
    }
    return this.rooms.size;
  }

  create(): Room {
    let code = makeRoomCode();
    while (this.rooms.has(code)) code = makeRoomCode();

    const room: Room = {
      code,
      seats: [],
      state: null,
      started: false,
      seq: 0,
    };
    this.rooms.set(code, room);
    void this.persist(room);
    return room;
  }

  get(code: string): Room | undefined {
    return isRoomCode(code) ? this.rooms.get(code) : undefined;
  }

  /** Seat a player. A known token always wins — that is the reconnect path,
   *  and it works whether the socket died a second ago or the whole process
   *  restarted in between. */
  join(
    room: Room,
    name: string,
    socket: WebSocket,
    presented?: string,
  ): { seat: Seat } | { error: string } {
    if (presented) {
      const seat = room.seats.find((s) => s.token === presented);
      if (seat) {
        seat.socket?.close(4000, 'replaced by a newer connection');
        seat.socket = socket;
        seat.connected = true;
        if (name.trim()) seat.name = name.trim().slice(0, 16);
        return { seat };
      }
    }

    if (room.started) {
      return { error: 'That game has already started.' };
    }
    if (room.seats.length >= MAX_PLAYERS) {
      return { error: `A room holds at most ${MAX_PLAYERS} players.` };
    }

    const seat: Seat = {
      playerId: `p${room.seats.length}`,
      token: token(),
      name: name.trim().slice(0, 16) || `Player ${room.seats.length + 1}`,
      connected: true,
      socket,
    };
    room.seats.push(seat);
    void this.persist(room);
    return { seat };
  }

  start(room: Room): string | null {
    if (room.started) return 'The game has already started.';
    if (room.seats.length < MIN_PLAYERS) {
      return `You need at least ${MIN_PLAYERS} players.`;
    }
    room.state = reduce(
      createGame(room.seats.map((s) => s.name)),
      { type: 'START_ROUND' },
    );
    room.started = true;
    void this.persist(room);
    return null;
  }

  apply(room: Room, seat: Seat, action: Action): string | null {
    if (!room.state) return 'The game has not started.';

    const refusal = authorize(action, seat.playerId);
    if (refusal) return refusal;

    room.state = reduce(room.state, action);
    void this.persist(room);
    return null;
  }

  /** A socket dropped. Mark the seat offline but never free it — the player's
   *  buildings, tiles and money have nowhere to go, and they are very likely
   *  about to reconnect. */
  detach(socket: WebSocket): Room | undefined {
    for (const room of this.rooms.values()) {
      const seat = room.seats.find((s) => s.socket === socket);
      if (!seat) continue;
      seat.socket = null;
      seat.connected = false;
      return room;
    }
    return undefined;
  }

  presence(room: Room): Presence[] {
    return room.seats.map((seat) => ({
      playerId: seat.playerId,
      name: seat.name,
      connected: seat.connected,
    }));
  }

  /** Every player gets their own payload, because money is secret. */
  broadcast(room: Room): void {
    room.seq += 1;
    const presence = this.presence(room);

    for (const seat of room.seats) {
      if (!seat.socket) continue;
      send(seat.socket, {
        t: 'state',
        room: room.code,
        state: room.state ? viewFor(room.state, seat.playerId) : null,
        presence,
        started: room.started,
        seq: room.seq,
      });
    }
  }

  private persist(room: Room): Promise<void> {
    const stored: StoredRoom = {
      code: room.code,
      seats: room.seats.map(({ playerId, token: t, name }) => ({
        playerId,
        token: t,
        name,
      })),
      state: room.state,
      started: room.started,
      updatedAt: Date.now(),
    };
    return this.store.save(stored);
  }
}

export function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState !== 1) return; // OPEN
  socket.send(JSON.stringify(message));
}
