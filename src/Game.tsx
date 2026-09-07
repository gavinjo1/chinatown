import { useState } from 'react';
import { Board } from './components/Board';
import { DealPanel } from './components/DealPanel';
import { tileTypeOf, type Action } from './engine/game';
import { businessesFor, incomeFor, tilesOnBoard } from './engine/income';
import { BUSINESS_BY_ID, BUSINESS_TYPES, dealFor } from './engine/rules';
import type { LotId } from './engine/types';
import type { GameView } from './engine/view';
import type { Presence } from './shared/protocol';

interface Props {
  game: GameView;
  /** The seat this browser controls. null means hotseat: every seat is ours. */
  playerId: string | null;
  presence?: Presence[];
  dispatch: (action: Action) => void;
}

const cash = (amount: number | undefined) =>
  amount === undefined ? '—' : `$${amount}k`;

export function Game({ game, playerId, presence, dispatch }: Props) {
  const [selectedTile, setSelectedTile] = useState<string | null>(null);
  const [keeping, setKeeping] = useState<LotId[]>([]);

  const hotseat = playerId === null;
  const acting =
    game.players.find((p) => p.id === playerId) ?? game.players[game.activePlayer];

  const openDeals = game.deals.filter((d) => d.status === 'open');
  const { keep } = dealFor(game.players.length, game.round);
  const keepTarget = Math.min(keep, acting.pendingLots.length);
  const isReady = game.ready.includes(acting.id);

  const actionable =
    game.phase === 'keep'
      ? new Set<LotId>(acting.pendingLots)
      : game.phase === 'build'
        ? new Set<LotId>(acting.lots.filter((l) => !game.placements[l]))
        : new Set<LotId>();

  const switchTo = (index: number) => {
    dispatch({ type: 'SET_ACTING_PLAYER', index });
    setSelectedTile(null);
    setKeeping([]);
  };

  const onLotClick = (lot: LotId) => {
    if (game.phase === 'keep') {
      if (!acting.pendingLots.includes(lot)) return;
      setKeeping((current) =>
        current.includes(lot)
          ? current.filter((l) => l !== lot)
          : current.length >= keepTarget
            ? current
            : [...current, lot],
      );
      return;
    }
    if (game.phase !== 'build' || !selectedTile || !actionable.has(lot)) return;
    dispatch({ type: 'PLACE_TILE', player: acting.id, tile: selectedTile, lot });
    setSelectedTile(null);
  };

  const confirmKeep = () => {
    dispatch({ type: 'KEEP_LOTS', player: acting.id, lots: keeping });
    setKeeping([]);
    if (!hotseat) return;
    const nextIndex = game.players.findIndex(
      (p, i) => i !== game.activePlayer && p.pendingLots.length > 0,
    );
    if (nextIndex >= 0) dispatch({ type: 'SET_ACTING_PLAYER', index: nextIndex });
  };

  const readyCount = `${game.ready.length}/${game.players.length} ready`;

  return (
    <>
      <header className="topbar">
        <h1>Chinatown</h1>
        <span className="round">
          {1964 + game.round} · round {game.round}/{game.maxRounds}
        </span>
        <span className={`phase phase-${game.phase}`}>{game.phase}</span>

        <div className="spacer" />

        {hotseat ? (
          <label className="acting">
            acting as
            <select
              value={game.activePlayer}
              onChange={(e) => switchTo(Number(e.target.value))}
            >
              {game.players.map((p, i) => (
                <option key={p.id} value={i}>
                  {p.name}
                  {p.pendingLots.length > 0 ? ' •' : ''}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <span className="acting">
            you are <b style={{ color: acting.color }}>{acting.name}</b>
          </span>
        )}

        {(game.phase === 'negotiate' || game.phase === 'build') &&
          (hotseat ? (
            <button
              onClick={() =>
                dispatch({
                  type:
                    game.phase === 'negotiate' ? 'END_NEGOTIATION' : 'END_BUILD',
                })
              }
            >
              {game.phase === 'negotiate' ? 'Close negotiation →' : 'Collect income →'}
            </button>
          ) : (
            <button
              className={isReady ? 'ghost' : ''}
              onClick={() =>
                dispatch({
                  type: 'SET_READY',
                  player: acting.id,
                  ready: !isReady,
                })
              }
            >
              {isReady ? `Waiting · ${readyCount}` : `Ready · ${readyCount}`}
            </button>
          ))}

        {game.phase === 'income' && (
          <button onClick={() => dispatch({ type: 'START_ROUND' })}>
            Start {1965 + game.round} →
          </button>
        )}
      </header>

      <main>
        <section className="boardpane">
          <Board
            state={game}
            actionable={actionable}
            selected={game.phase === 'keep' ? new Set(keeping) : undefined}
            onLotClick={onLotClick}
          />
          {game.phase === 'keep' && (
            <p className="hint">
              {acting.pendingLots.length === 0
                ? hotseat
                  ? `${acting.name} has chosen — switch to a player marked •`
                  : 'Waiting for the other players to choose…'
                : `${acting.name}: pick ${keepTarget} of ${acting.pendingLots.length} buildings to keep (${keeping.length} chosen).`}
            </p>
          )}
          {game.phase === 'build' && (
            <p className="hint">
              {selectedTile
                ? 'Now click one of your vacant buildings.'
                : 'Pick a shop tile, then click a vacant building you own.'}
            </p>
          )}
        </section>

        <aside>
          {game.phase === 'gameover' && <FinalScore game={game} />}

          <div className="panel">
            <h2>Players</h2>
            <table className="score">
              <tbody>
                {game.players.map((p) => {
                  const businesses = businessesFor(game, p.id);
                  const online = presence?.find((s) => s.playerId === p.id);
                  return (
                    <tr key={p.id}>
                      <td>
                        <span className="dot" style={{ background: p.color }} />
                        {p.name}
                        {online && !online.connected && (
                          <span className="offline" title="reconnecting">
                            ⚠
                          </span>
                        )}
                      </td>
                      <td className="num">{cash(p.money)}</td>
                      <td className="num muted">+${incomeFor(game, p.id)}k/yr</td>
                      <td className="num muted">
                        {businesses.length} biz (
                        {businesses.filter((b) => b.complete).length} done)
                      </td>
                      <td className="num muted">{tilesOnBoard(game, p.id)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <Hands game={game} />

          {game.phase === 'keep' && acting.pendingLots.length > 0 && (
            <div className="panel">
              <h2>
                Keep {keepTarget} of {acting.pendingLots.length}
                <button
                  disabled={keeping.length !== keepTarget}
                  onClick={confirmKeep}
                >
                  Confirm
                </button>
              </h2>
              <div className="lots">
                {acting.pendingLots.map((l) => (
                  <button
                    key={l}
                    className={`chip pick ${keeping.includes(l) ? 'on' : ''}`}
                    onClick={() => onLotClick(l)}
                  >
                    {l}
                  </button>
                ))}
              </div>
              <p className="muted">
                Discards go back into the pile and are reshuffled.
              </p>
            </div>
          )}

          <div className="panel">
            <h2>
              {acting.name}’s hand
              <span className="muted"> · {cash(acting.money)}</span>
            </h2>
            <div className="lots">
              {acting.lots.length === 0 && (
                <span className="muted">no vacant buildings</span>
              )}
              {acting.lots.map((l) => (
                <span key={l} className="chip">
                  {l}
                </span>
              ))}
            </div>
            <div className="tiles">
              {acting.tiles.length === 0 && (
                <span className="muted">no shop tiles</span>
              )}
              {acting.tiles.map((t) => {
                const business = BUSINESS_BY_ID[tileTypeOf(t)!];
                return (
                  <button
                    key={t}
                    className={`tile ${selectedTile === t ? 'sel' : ''}`}
                    style={{ background: business.color }}
                    disabled={game.phase !== 'build'}
                    onClick={() => setSelectedTile(t)}
                  >
                    {business.emoji} {business.name}
                    <em>max {business.maxSize}</em>
                  </button>
                );
              })}
            </div>
          </div>

          {game.phase === 'negotiate' && (
            <div className="panel">
              <h2>
                Deals
                <button onClick={() => dispatch({ type: 'CREATE_DEAL' })}>
                  + New deal
                </button>
              </h2>
              {openDeals.length === 0 && (
                <p className="muted">
                  No open deals. Anything can be traded — buildings with or
                  without shops on them, tiles, and cash — between any number of
                  players at once.
                </p>
              )}
              {openDeals.map((deal) => (
                <DealPanel
                  key={deal.id}
                  state={game}
                  deal={deal}
                  viewer={playerId}
                  dispatch={dispatch}
                />
              ))}
            </div>
          )}

          <div className="panel log">
            <h2>Log</h2>
            {game.log.slice(0, 40).map((line, i) => (
              <div key={i}>{line}</div>
            ))}
          </div>
        </aside>
      </main>
    </>
  );
}

/** Final standings. Balances are revealed once the game is over, so this is
 *  the one place every player's money is on show. Ties go to the most shop
 *  tiles on the board. */
function FinalScore({ game }: { game: GameView }) {
  const standings = [...game.players].sort(
    (a, b) =>
      (b.money ?? 0) - (a.money ?? 0) ||
      tilesOnBoard(game, b.id) - tilesOnBoard(game, a.id),
  );

  return (
    <div className="panel final">
      <h2>1970 · final standings</h2>
      <table className="score">
        <tbody>
          {standings.map((player, rank) => (
            <tr key={player.id} className={rank === 0 ? 'winner' : ''}>
              <td>
                {rank === 0 ? '🏆' : `${rank + 1}.`}{' '}
                <span className="dot" style={{ background: player.color }} />
                {player.name}
              </td>
              <td className="num">{cash(player.money)}</td>
              <td className="num muted">{tilesOnBoard(game, player.id)} tiles</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Tiles in hand and vacant buildings are open information under the rules,
 *  so every player can see everyone's. Only money is secret. */
function Hands({ game }: { game: GameView }) {
  const grouped = (tiles: string[]) => {
    const counts = new Map<string, number>();
    for (const tile of tiles) {
      const type = tileTypeOf(tile);
      if (type) counts.set(type, (counts.get(type) ?? 0) + 1);
    }
    return BUSINESS_TYPES.filter((t) => counts.has(t.id)).map(
      (t) => [t, counts.get(t.id)!] as const,
    );
  };

  return (
    <div className="panel">
      <h2>
        All hands<span className="muted">public info</span>
      </h2>
      {game.players.map((player) => {
        const tiles = grouped(player.tiles);
        const buildings = [...player.lots].sort((a, b) => a - b);
        return (
          <div key={player.id} className="handrow">
            <div className="who">
              <span className="dot" style={{ background: player.color }} />
              {player.name}
            </div>
            <div className="mini">
              {tiles.length === 0 && <span className="muted">no tiles</span>}
              {tiles.map(([type, count]) => (
                <span
                  key={type.id}
                  className="minitile"
                  style={{ background: type.color }}
                  title={`${type.name} · completes at ${type.maxSize}`}
                >
                  {type.emoji}
                  {count > 1 && <b>{count}</b>}
                </span>
              ))}
            </div>
            <div className="mini">
              {buildings.length === 0 && (
                <span className="muted">no vacant buildings</span>
              )}
              {buildings.map((lot) => (
                <span key={lot} className="chip tiny">
                  {lot}
                </span>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
