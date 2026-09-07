import { useState } from 'react';
import type { Action } from '../engine/game';
import { tileTypeOf } from '../engine/game';
import { BUSINESS_BY_ID } from '../engine/rules';
import { allPartiesConfirmed, dealParties, validateDeal } from '../engine/trade';
import type { Deal, DealItem } from '../engine/types';
import type { GameView } from '../engine/view';

interface Props {
  state: GameView;
  deal: Deal;
  /** The seat this browser controls; null in hotseat. */
  viewer: string | null;
  dispatch: (action: Action) => void;
}

type Kind = 'lot' | 'tile' | 'cash';

export function DealPanel({ state, deal, viewer, dispatch }: Props) {
  // Default to offering something of your own — that is the common case.
  const mine = viewer ?? state.players[0].id;
  const [from, setFrom] = useState(mine);
  const [to, setTo] = useState(
    state.players.find((p) => p.id !== mine)!.id,
  );
  const [kind, setKind] = useState<Kind>('lot');
  const [asset, setAsset] = useState('');
  const [amount, setAmount] = useState(5);
  const [promise, setPromise] = useState('');

  const nameOf = (id: string) =>
    state.players.find((p) => p.id === id)?.name ?? id;
  const fromPlayer = state.players.find((p) => p.id === from)!;
  /* Every building they own, not just the vacant ones — a building can be
   * traded with a shop already standing on it. */
  const ownedBuildings = Object.entries(state.ownership)
    .filter(([, owner]) => owner === from)
    .map(([lot]) => Number(lot))
    .sort((a, b) => a - b);
  const parties = dealParties(deal);
  const problems = validateDeal(deal, state);
  const ready = allPartiesConfirmed(deal);

  const addItem = () => {
    let item: DealItem | null = null;
    if (kind === 'cash') {
      item = { kind: 'cash', from, to, amount };
    } else if (kind === 'lot' && asset) {
      item = { kind: 'lot', from, to, lot: Number(asset) };
    } else if (kind === 'tile' && asset) {
      item = { kind: 'tile', from, to, tile: asset };
    }
    if (!item || from === to) return;
    dispatch({ type: 'ADD_DEAL_ITEM', dealId: deal.id, item });
    setAsset('');
  };

  const describe = (item: DealItem) => {
    if (item.kind === 'cash') return `$${item.amount}k`;
    if (item.kind === 'lot') {
      const built = state.placements[item.lot];
      return built
        ? `Building ${item.lot} ${BUSINESS_BY_ID[built.type].emoji}`
        : `Building ${item.lot}`;
    }
    const type = tileTypeOf(item.tile);
    return type ? `${BUSINESS_BY_ID[type].name} tile` : 'tile';
  };

  const labelFor = (lot: number) => {
    const built = state.placements[lot];
    return built
      ? `Building ${lot} — ${BUSINESS_BY_ID[built.type].name}`
      : `Building ${lot} — vacant`;
  };

  return (
    <div className="deal">
      <header>
        <strong>Deal #{deal.id}</strong>
        <button
          className="ghost"
          onClick={() => dispatch({ type: 'CANCEL_DEAL', dealId: deal.id })}
        >
          Discard
        </button>
      </header>

      {deal.items.length === 0 && deal.promises.length === 0 && (
        <p className="muted">
          Empty. Add transfers below — any number of players can be involved.
        </p>
      )}

      <ul className="items">
        {deal.items.map((item, i) => (
          <li key={i}>
            <span className="who">
              {nameOf(item.from)} <span className="arrow">→</span>{' '}
              {nameOf(item.to)}
            </span>
            <span className="what">{describe(item)}</span>
            <button
              className="ghost tiny"
              onClick={() =>
                dispatch({
                  type: 'REMOVE_DEAL_ITEM',
                  dealId: deal.id,
                  index: i,
                })
              }
            >
              ×
            </button>
          </li>
        ))}
        {deal.promises.map((p, i) => (
          <li key={`promise-${i}`} className="promise">
            <span className="who">
              {nameOf(p.from)} <span className="arrow">→</span> {nameOf(p.to)}
            </span>
            <span className="what">IOU: “{p.text}”</span>
          </li>
        ))}
      </ul>

      <div className="builder">
        <select value={from} onChange={(e) => setFrom(e.target.value)}>
          {state.players.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <span className="arrow">→</span>
        <select value={to} onChange={(e) => setTo(e.target.value)}>
          {state.players.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>

        <select
          value={kind}
          onChange={(e) => {
            setKind(e.target.value as Kind);
            setAsset('');
          }}
        >
          <option value="lot">Building</option>
          <option value="tile">Tile</option>
          <option value="cash">Cash</option>
        </select>

        {kind === 'lot' && (
          <select value={asset} onChange={(e) => setAsset(e.target.value)}>
            <option value="">choose building…</option>
            {ownedBuildings.map((l) => (
              <option key={l} value={l}>
                {labelFor(l)}
              </option>
            ))}
          </select>
        )}

        {kind === 'tile' && (
          <select value={asset} onChange={(e) => setAsset(e.target.value)}>
            <option value="">choose tile…</option>
            {fromPlayer.tiles.map((t) => {
              const type = tileTypeOf(t);
              return (
                <option key={t} value={t}>
                  {type ? BUSINESS_BY_ID[type].name : t}
                </option>
              );
            })}
          </select>
        )}

        {kind === 'cash' && (
          <input
            type="number"
            min={1}
            value={amount}
            onChange={(e) => setAmount(Number(e.target.value))}
          />
        )}

        <button onClick={addItem}>Add</button>
      </div>

      <div className="builder">
        <input
          className="grow"
          placeholder="Add a non-binding promise…"
          value={promise}
          onChange={(e) => setPromise(e.target.value)}
        />
        <button
          onClick={() => {
            if (!promise.trim() || from === to) return;
            dispatch({
              type: 'ADD_PROMISE',
              dealId: deal.id,
              promise: { from, to, text: promise.trim() },
            });
            setPromise('');
          }}
        >
          IOU
        </button>
      </div>

      {problems.length > 0 && (
        <p className="warn">{problems[0]}</p>
      )}

      {parties.length > 0 && (
        <div className="confirms">
          {parties.map((id) => {
            const checked = deal.confirmed.includes(id);
            return (
              <label key={id} className={checked ? 'on' : ''}>
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={
                    problems.length > 0 || (viewer !== null && id !== viewer)
                  }
                  onChange={(e) =>
                    dispatch({
                      type: 'SET_CONFIRM',
                      dealId: deal.id,
                      player: id,
                      confirmed: e.target.checked,
                    })
                  }
                />
                {nameOf(id)}
              </label>
            );
          })}
          <span className="muted">
            {ready
              ? 'executing…'
              : `${deal.confirmed.length}/${parties.length} confirmed`}
          </span>
        </div>
      )}
    </div>
  );
}
