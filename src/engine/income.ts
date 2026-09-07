import { NEIGHBOURS } from './board';
import { BUSINESS_BY_ID, businessIncome } from './rules';
import type { Business, GameState, LotId, PlayerId } from './types';

/* Only the board matters for income, so these take the narrowest slice of
 * state they need. That lets them run against a redacted view as well as the
 * authoritative state. */
type BoardState = Pick<GameState, 'placements'>;

/** Every connected run of same-owner, same-type tiles on the board. */
function findGroups(state: BoardState): LotId[][] {
  const seen = new Set<LotId>();
  const groups: LotId[][] = [];

  for (const placement of Object.values(state.placements)) {
    if (seen.has(placement.lot)) continue;

    const group: LotId[] = [];
    const queue: LotId[] = [placement.lot];
    seen.add(placement.lot);

    while (queue.length > 0) {
      const current = queue.pop()!;
      group.push(current);

      for (const neighbour of NEIGHBOURS[current]) {
        if (seen.has(neighbour)) continue;
        const other = state.placements[neighbour];
        if (
          other &&
          other.owner === placement.owner &&
          other.type === placement.type
        ) {
          seen.add(neighbour);
          queue.push(neighbour);
        }
      }
    }

    groups.push(group);
  }

  return groups;
}

/** Find every business on the board.
 *
 *  A connected group larger than its type's maximum does NOT become one giant
 *  business — the rules split it into as many complete businesses as fit plus
 *  a remainder. Five adjacent Photo shops (max 3) are a complete business of 3
 *  ($50k) and a separate incomplete one of 2 ($20k), not a single $50k shop. */
export function findBusinesses(state: BoardState): Business[] {
  const businesses: Business[] = [];

  for (const group of findGroups(state)) {
    const first = state.placements[group[0]];
    const max = BUSINESS_BY_ID[first.type].maxSize;

    for (let offset = 0; offset < group.length; offset += max) {
      const lots = group.slice(offset, offset + max);
      businesses.push({
        owner: first.owner,
        type: first.type,
        lots,
        size: lots.length,
        complete: lots.length === max,
        income: businessIncome(lots.length, max),
      });
    }
  }

  return businesses;
}

export function businessesFor(state: BoardState, player: PlayerId): Business[] {
  return findBusinesses(state).filter((b) => b.owner === player);
}

/** Total per-round income for one player. */
export function incomeFor(state: BoardState, player: PlayerId): number {
  return businessesFor(state, player).reduce((sum, b) => sum + b.income, 0);
}

/** Shop tiles a player has on the board — the tie-breaker at game end. */
export function tilesOnBoard(state: BoardState, player: PlayerId): number {
  return Object.values(state.placements).filter((p) => p.owner === player)
    .length;
}
