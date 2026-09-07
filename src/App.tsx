import { useEffect, useState } from 'react';

import { Game } from './Game';
import { createGame, reduce, type Action } from './engine/game';
import type { GameState } from './engine/types';
import { useOnlineGame } from './net/useOnlineGame';
import { MAX_PLAYERS, MIN_PLAYERS, isRoomCode } from './shared/protocol';

const NAME_KEY = 'chinatown:name';

export default function App() {
  const [path, setPath] = useState(location.pathname);

  // Back and forward move within the app instead of leaving the page, so a
  // mis-tapped back button no longer drops you out of a room.
  useEffect(() => {
    const onPop = () => setPath(location.pathname);
    addEventListener('popstate', onPop);
    return () => removeEventListener('popstate', onPop);
  }, []);

  const navigate = (to: string) => {
    history.pushState({}, '', to);
    setPath(to);
  };

  const roomMatch = /^\/r\/([A-Za-z0-9]{4})$/.exec(path);
  if (roomMatch) return <Room code={roomMatch[1].toUpperCase()} />;
  if (path === '/hotseat') return <Hotseat />;
  return <Home navigate={navigate} />;
}

/* ---------- home -------------------------------------------------------- */

function Home({ navigate }: { navigate: (to: string) => void }) {
  const [name, setName] = useState(localStorage.getItem(NAME_KEY) ?? '');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remember = (value: string) => {
    setName(value);
    localStorage.setItem(NAME_KEY, value);
  };

  const createRoom = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/room', { method: 'POST' });
      if (!response.ok) throw new Error(String(response.status));
      const { code: created } = await response.json();
      navigate(`/r/${created}`);
    } catch {
      setError('Could not reach the server. Is it running?');
      setBusy(false);
    }
  };

  return (
    <div className="setup">
      <h1>Chinatown</h1>
      <p className="muted">New York, 1965–1970 · {MIN_PLAYERS}–{MAX_PLAYERS} players</p>

      <input
        placeholder="Your name"
        value={name}
        maxLength={16}
        onChange={(e) => remember(e.target.value)}
      />

      <button className="primary" disabled={busy} onClick={createRoom}>
        {busy ? 'Creating…' : 'Create a room'}
      </button>

      <div className="row">
        <input
          className="grow"
          placeholder="Room code"
          value={code}
          maxLength={4}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
        />
        <button
          className="ghost"
          disabled={!isRoomCode(code)}
          onClick={() => navigate(`/r/${code}`)}
        >
          Join
        </button>
      </div>

      {error && <p className="warn">{error}</p>}

      <button className="ghost" onClick={() => navigate('/hotseat')}>
        Play hotseat on this device
      </button>
    </div>
  );
}

/* ---------- online room ------------------------------------------------- */

function Room({ code }: { code: string }) {
  const [name, setName] = useState(localStorage.getItem(NAME_KEY) ?? '');

  // Someone opening a shared link has never seen the home screen, so ask who
  // they are before taking a seat — otherwise they join as "Player 3".
  if (!name.trim()) {
    return (
      <NameGate
        code={code}
        onName={(chosen) => {
          localStorage.setItem(NAME_KEY, chosen);
          setName(chosen);
        }}
      />
    );
  }
  return <ConnectedRoom code={code} name={name} />;
}

function NameGate({
  code,
  onName,
}: {
  code: string;
  onName: (name: string) => void;
}) {
  const [draft, setDraft] = useState('');
  const submit = () => draft.trim() && onName(draft.trim());

  return (
    <div className="setup">
      <h1>Join room {code}</h1>
      <p className="muted">What should the others call you?</p>
      <input
        autoFocus
        placeholder="Your name"
        value={draft}
        maxLength={16}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
      />
      <button className="primary" disabled={!draft.trim()} onClick={submit}>
        Take a seat
      </button>
    </div>
  );
}

function ConnectedRoom({ code, name }: { code: string; name: string }) {
  const net = useOnlineGame(code, name);

  const banner =
    net.status !== 'live' ? (
      <div className="banner">
        {net.status === 'connecting' ? 'Connecting…' : 'Reconnecting…'}
      </div>
    ) : null;

  if (net.error && !net.state) {
    return (
      <div className="setup">
        <h1>Chinatown</h1>
        <p className="warn">{net.error}</p>
        <button className="ghost" onClick={() => (location.href = '/')}>
          Back
        </button>
      </div>
    );
  }

  if (!net.started || !net.state) {
    return (
      <>
        {banner}
        <RoomLobby code={code} net={net} />
      </>
    );
  }

  return (
    <div className="app">
      {banner}
      <Game
        game={net.state}
        playerId={net.playerId}
        presence={net.presence}
        dispatch={net.dispatch}
      />
    </div>
  );
}

function RoomLobby({
  code,
  net,
}: {
  code: string;
  net: ReturnType<typeof useOnlineGame>;
}) {
  const [copied, setCopied] = useState(false);
  const link = `${location.origin}/r/${code}`;
  const enough = net.presence.length >= MIN_PLAYERS;

  return (
    <div className="setup">
      <h1>Room {code}</h1>
      <p className="muted">
        Share the link. Everyone needs to be here before the game starts —
        seats are locked once it does.
      </p>

      <div className="row">
        <input className="grow" readOnly value={link} />
        <button
          className="ghost"
          onClick={() => {
            navigator.clipboard.writeText(link).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>

      <div className="panel">
        <h2>
          Players<span className="muted">{net.presence.length}/{MAX_PLAYERS}</span>
        </h2>
        {net.presence.length === 0 && <p className="muted">Nobody yet…</p>}
        {net.presence.map((seat) => (
          <div key={seat.playerId} className="handrow">
            <div className="who">
              {seat.name}
              {seat.playerId === net.playerId && (
                <span className="muted"> (you)</span>
              )}
            </div>
            <div className="mini muted">
              {seat.connected ? 'here' : 'reconnecting…'}
            </div>
          </div>
        ))}
      </div>

      {net.error && <p className="warn">{net.error}</p>}

      <button className="primary" disabled={!enough} onClick={net.start}>
        {enough ? 'Start game' : `Waiting for ${MIN_PLAYERS} players`}
      </button>
    </div>
  );
}

/* ---------- hotseat ----------------------------------------------------- */

function Hotseat() {
  const [game, setGame] = useState<GameState | null>(null);
  const [names, setNames] = useState(['Ann', 'Ben', 'Cai']);

  const dispatch = (action: Action) =>
    setGame((current) => (current ? reduce(current, action) : current));

  if (!game) {
    return (
      <div className="setup">
        <h1>Chinatown</h1>
        <p className="muted">Hotseat · {MIN_PLAYERS}–{MAX_PLAYERS} players</p>
        {names.map((name, i) => (
          <input
            key={i}
            value={name}
            onChange={(e) => {
              const next = [...names];
              next[i] = e.target.value;
              setNames(next);
            }}
          />
        ))}
        <div className="row">
          <button
            className="ghost"
            disabled={names.length >= MAX_PLAYERS}
            onClick={() => setNames([...names, `Player ${names.length + 1}`])}
          >
            + player
          </button>
          <button
            className="ghost"
            disabled={names.length <= MIN_PLAYERS}
            onClick={() => setNames(names.slice(0, -1))}
          >
            − player
          </button>
        </div>
        <button
          className="primary"
          onClick={() => setGame(reduce(createGame(names), { type: 'START_ROUND' }))}
        >
          Start game
        </button>
      </div>
    );
  }

  return (
    <div className="app">
      <Game game={game} playerId={null} dispatch={dispatch} />
    </div>
  );
}
