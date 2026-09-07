import { useCallback, useEffect, useRef, useState } from 'react';

import type { Action } from '../engine/game';
import type { GameView } from '../engine/view';
import type {
  ClientMessage,
  Presence,
  ServerMessage,
} from '../shared/protocol';

export type NetStatus = 'connecting' | 'live' | 'reconnecting';

export interface OnlineGame {
  status: NetStatus;
  error: string | null;
  playerId: string | null;
  state: GameView | null;
  presence: Presence[];
  started: boolean;
  dispatch: (action: Action) => void;
  start: () => void;
}

const RETRY_CAP_MS = 10_000;
/** Well inside any proxy's idle timeout. */
const CLIENT_PING_MS = 20_000;

const tokenKey = (room: string) => `chinatown:token:${room}`;

function socketUrl(): string {
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${scheme}://${location.host}/ws`;
}

/** Holds a seat in `room` across refreshes, back-button navigations and
 *  dropped connections.
 *
 *  The seat is owned by a token in localStorage, never by the socket. A new
 *  socket presents the token and reclaims the same seat, so a refresh is
 *  invisible to the other players beyond a brief "reconnecting" flicker. */
export function useOnlineGame(room: string, name: string): OnlineGame {
  const [status, setStatus] = useState<NetStatus>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [state, setState] = useState<GameView | null>(null);
  const [presence, setPresence] = useState<Presence[]>([]);
  const [started, setStarted] = useState(false);

  const socketRef = useRef<WebSocket | null>(null);
  const seqRef = useRef(0);
  // Kept in a ref so editing your name does not tear down the connection.
  const nameRef = useRef(name);
  nameRef.current = name;

  useEffect(() => {
    let disposed = false;
    let attempt = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let ping: ReturnType<typeof setInterval> | undefined;

    const connect = () => {
      if (disposed) return;
      setStatus(attempt === 0 ? 'connecting' : 'reconnecting');

      const socket = new WebSocket(socketUrl());
      socketRef.current = socket;

      socket.onopen = () => {
        attempt = 0;
        const token = localStorage.getItem(tokenKey(room)) ?? undefined;
        const join: ClientMessage = { t: 'join', room, name: nameRef.current, token };
        socket.send(JSON.stringify(join));
        ping = setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ t: 'ping' } satisfies ClientMessage));
          }
        }, CLIENT_PING_MS);
      };

      socket.onmessage = (event) => {
        let message: ServerMessage;
        try {
          message = JSON.parse(event.data);
        } catch {
          return;
        }

        switch (message.t) {
          case 'joined':
            localStorage.setItem(tokenKey(room), message.token);
            setPlayerId(message.playerId);
            setError(null);
            setStatus('live');
            break;
          case 'state':
            // Ignore a frame that lost a race with a newer one.
            if (message.seq < seqRef.current) break;
            seqRef.current = message.seq;
            setState(message.state);
            setPresence(message.presence);
            setStarted(message.started);
            setStatus('live');
            break;
          case 'error':
            setError(message.reason);
            break;
          case 'pong':
            break;
        }
      };

      socket.onclose = () => {
        clearInterval(ping);
        if (disposed) return;
        setStatus('reconnecting');
        // Exponential backoff with a ceiling, so a server restart recovers
        // quickly but a long outage does not hammer it.
        const delay = Math.min(RETRY_CAP_MS, 500 * 2 ** attempt++);
        retry = setTimeout(connect, delay);
      };

      socket.onerror = () => socket.close();
    };

    connect();

    return () => {
      disposed = true;
      clearTimeout(retry);
      clearInterval(ping);
      socketRef.current?.close();
    };
  }, [room]);

  const post = useCallback((message: ClientMessage) => {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  }, []);

  return {
    status,
    error,
    playerId,
    state,
    presence,
    started,
    dispatch: useCallback((action: Action) => post({ t: 'action', action }), [post]),
    start: useCallback(() => post({ t: 'start' }), [post]),
  };
}
