import type { Action } from '../engine/game';
import type { GameView } from '../engine/view';

/** Who is at the table and whether their socket is currently up. */
export interface Presence {
  playerId: string;
  name: string;
  connected: boolean;
}

export type ClientMessage =
  /** `token` is present on every join after the first — it is how a player
   *  reclaims their seat after a refresh, a back button, or a dropped wifi. */
  | { t: 'join'; room: string; name: string; token?: string }
  | { t: 'action'; action: Action }
  | { t: 'start' }
  | { t: 'ping' };

export type ServerMessage =
  | { t: 'joined'; room: string; playerId: string; token: string }
  | {
      t: 'state';
      room: string;
      /** null until the host starts the game. */
      state: GameView | null;
      presence: Presence[];
      started: boolean;
      /** Monotonic per room; lets a client ignore an out-of-order frame. */
      seq: number;
    }
  | { t: 'error'; reason: string }
  | { t: 'pong' };

export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 5;

/** Room codes avoid characters that are easy to misread aloud (0/O, 1/I). */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function makeRoomCode(): string {
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}

export function isRoomCode(value: string): boolean {
  return /^[A-Z0-9]{4}$/.test(value);
}
