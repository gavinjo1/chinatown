import type { Deal, DealItem, GameState, PlayerId } from './types';
import type { GameView } from './view';

/* The shared-deal-table model.
 *
 * A deal is a flat list of directed transfers plus a confirmation set. Any
 * player may add or remove items; every edit clears all confirmations. When
 * every involved party has confirmed, the deal executes atomically. Two-party
 * and five-party trades use exactly the same code path — the party list is
 * derived from the items rather than fixed up front.
 *
 * Assets are deliberately NOT locked while a deal is open, so several deals
 * can be negotiated in parallel like they are at a table. Validity is checked
 * at commit time instead; a deal that has gone stale fails as a whole. */

/** Every player touched by a deal, in stable order. */
export function dealParties(deal: Deal): PlayerId[] {
  const parties = new Set<PlayerId>();
  for (const item of deal.items) {
    parties.add(item.from);
    parties.add(item.to);
  }
  for (const promise of deal.promises) {
    parties.add(promise.from);
    parties.add(promise.to);
  }
  return [...parties];
}

export function allPartiesConfirmed(deal: Deal): boolean {
  const parties = dealParties(deal);
  if (parties.length < 2) return false;
  return parties.every((p) => deal.confirmed.includes(p));
}

/** Net cash movement per player for a deal. Negative means they pay out. */
function netCash(deal: Deal): Map<PlayerId, number> {
  const net = new Map<PlayerId, number>();
  const bump = (id: PlayerId, delta: number) =>
    net.set(id, (net.get(id) ?? 0) + delta);
  for (const item of deal.items) {
    if (item.kind === 'cash') {
      bump(item.from, -item.amount);
      bump(item.to, item.amount);
    }
  }
  return net;
}

/** Checks a deal against current state. Returns a list of problems; an empty
 *  list means the deal can execute. Run this at commit time, not while the
 *  deal is being edited. */
export function validateDeal(deal: Deal, state: GameView): string[] {
  const problems: string[] = [];
  const byId = new Map(state.players.map((p) => [p.id, p]));
  const seenLots = new Set<number>();
  const seenTiles = new Set<string>();

  for (const item of deal.items) {
    const from = byId.get(item.from);
    const to = byId.get(item.to);
    if (!from || !to) {
      problems.push('Deal references a player who is not in the game.');
      continue;
    }
    if (item.from === item.to) {
      problems.push(`${from.name} cannot trade with themselves.`);
      continue;
    }

    if (item.kind === 'lot') {
      if (seenLots.has(item.lot)) {
        problems.push(`Building ${item.lot} appears twice in this deal.`);
      }
      seenLots.add(item.lot);
      // Ownership is the source of truth, so a building can be traded whether
      // or not a shop has already been built on it.
      if (state.ownership[item.lot] !== item.from) {
        problems.push(`${from.name} no longer owns building ${item.lot}.`);
      }
    }

    if (item.kind === 'tile') {
      if (seenTiles.has(item.tile)) {
        problems.push('The same tile appears twice in this deal.');
      }
      seenTiles.add(item.tile);
      if (!from.tiles.includes(item.tile)) {
        problems.push(`${from.name} no longer holds that tile.`);
      }
    }

    if (item.kind === 'cash' && item.amount <= 0) {
      problems.push('Cash amounts must be positive.');
    }
  }

  // Cash is checked on the net position so a player can pass money through.
  // Other players' balances are absent from a redacted view, so this check
  // only runs where it can — the server always sees the full state and is
  // the authority.
  for (const [playerId, delta] of netCash(deal)) {
    const player = byId.get(playerId);
    if (player?.money !== undefined && player.money + delta < 0) {
      problems.push(`${player.name} cannot cover their side of this deal.`);
    }
  }

  return problems;
}

/** Applies a deal to a draft state. Caller must have validated first. */
export function applyDeal(deal: Deal, state: GameState): void {
  const byId = new Map(state.players.map((p) => [p.id, p]));

  for (const item of deal.items) {
    const from = byId.get(item.from)!;
    const to = byId.get(item.to)!;

    switch (item.kind) {
      case 'lot': {
        state.ownership[item.lot] = to.id;
        const built = state.placements[item.lot];
        if (built) {
          // The shop stays put — only the ownership marker changes. This is
          // how businesses get consolidated, so it also merges or splits the
          // buyer's and seller's neighbouring businesses.
          built.owner = to.id;
        } else {
          from.lots = from.lots.filter((l) => l !== item.lot);
          to.lots = [...to.lots, item.lot];
        }
        break;
      }
      case 'tile':
        from.tiles = from.tiles.filter((t) => t !== item.tile);
        to.tiles = [...to.tiles, item.tile];
        break;
      case 'cash':
        from.money -= item.amount;
        to.money += item.amount;
        break;
    }
  }
}

export function describeItem(
  item: DealItem,
  nameOf: (id: PlayerId) => string,
): string {
  const who = `${nameOf(item.from)} → ${nameOf(item.to)}`;
  switch (item.kind) {
    case 'lot':
      return `${who}: lot ${item.lot}`;
    case 'tile':
      return `${who}: tile`;
    case 'cash':
      return `${who}: $${item.amount}k`;
  }
}
