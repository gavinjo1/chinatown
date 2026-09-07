import { LOTS } from './board';
import { incomeFor, tilesOnBoard } from './income';
import {
  BUSINESS_BY_ID,
  BUSINESS_TYPES,
  MAX_ROUNDS,
  PLAYER_COLORS,
  STARTING_MONEY,
  dealFor,
} from './rules';
import { allPartiesConfirmed, applyDeal, dealParties, validateDeal } from './trade';
import type { Deal, DealItem, GameState, Player, Promise_, Tile } from './types';

/* Small seeded RNG so a game can be replayed from its seed — useful now for
 * debugging and later for server-side deterministic setup. */
function mulberry32(seed: number) {
  return function random() {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], random: () => number): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function createGame(names: string[], seed = Date.now()): GameState {
  const random = mulberry32(seed);

  const players: Player[] = names.map((name, i) => ({
    id: `p${i}`,
    name,
    color: PLAYER_COLORS[i % PLAYER_COLORS.length],
    money: STARTING_MONEY,
    lots: [],
    tiles: [],
    pendingLots: [],
  }));

  const tiles: Tile[] = [];
  let tileId = 0;
  for (const type of BUSINESS_TYPES) {
    for (let i = 0; i < type.deckCount; i++) {
      tiles.push({ id: `t${tileId++}`, type: type.id });
    }
  }

  return {
    round: 0,
    maxRounds: MAX_ROUNDS,
    phase: 'setup',
    players,
    ownership: {},
    placements: {},
    lotDeck: shuffle(
      LOTS.map((l) => l.id),
      random,
    ),
    tileDeck: shuffle(tiles, random),
    activePlayer: 0,
    deals: [],
    nextDealId: 1,
    ready: [],
    seed,
    log: [`Game created with ${players.length} players.`],
  };
}

export type Action =
  | { type: 'START_ROUND' }
  | { type: 'KEEP_LOTS'; player: string; lots: number[] }
  | { type: 'SET_ACTING_PLAYER'; index: number }
  | { type: 'CREATE_DEAL' }
  | { type: 'ADD_DEAL_ITEM'; dealId: number; item: DealItem }
  | { type: 'REMOVE_DEAL_ITEM'; dealId: number; index: number }
  | { type: 'ADD_PROMISE'; dealId: number; promise: Promise_ }
  | { type: 'SET_CONFIRM'; dealId: number; player: string; confirmed: boolean }
  | { type: 'CANCEL_DEAL'; dealId: number }
  | { type: 'PLACE_TILE'; player: string; tile: string; lot: number }
  | { type: 'SET_READY'; player: string; ready: boolean }
  | { type: 'END_NEGOTIATION' }
  | { type: 'END_BUILD' };

type Log = (message: string) => void;

/** Phase 3 → 4. Open deals do not survive into the build phase. */
function closeNegotiation(state: GameState, log: Log): void {
  state.phase = 'build';
  state.ready = [];
  for (const deal of state.deals) {
    if (deal.status === 'open') deal.status = 'cancelled';
  }
  log('Negotiation closed. Build your businesses.');
}

/** Phase 5 → 6. Pays every business, then ends the game after 1970. */
function collectIncome(state: GameState, log: Log): void {
  state.phase = 'income';
  state.ready = [];
  for (const player of state.players) {
    const earned = incomeFor(state, player.id);
    player.money += earned;
    log(`${player.name} collected $${earned}k.`);
  }

  if (state.round >= state.maxRounds) {
    state.phase = 'gameover';
    // Most money wins; ties go to the most shop tiles on the board.
    const winner = [...state.players].sort(
      (a, b) =>
        b.money - a.money ||
        tilesOnBoard(state, b.id) - tilesOnBoard(state, a.id),
    )[0];
    log(`Game over — ${winner.name} wins with $${winner.money}k.`);
  }
}

export function reduce(state: GameState, action: Action): GameState {
  const next: GameState = structuredClone(state);
  const log = (message: string) => next.log.unshift(message);
  const nameOf = (id: string) =>
    next.players.find((p) => p.id === id)?.name ?? id;
  const findDeal = (id: number): Deal | undefined =>
    next.deals.find((d) => d.id === id && d.status === 'open');

  switch (action.type) {
    case 'START_ROUND': {
      next.round += 1;
      next.phase = 'keep';
      next.ready = [];
      // Phase 1 only. Shop tiles are NOT drawn yet — players must commit to
      // buildings before they know what businesses they will be holding.
      const { draw, keep } = dealFor(next.players.length, next.round);
      for (const player of next.players) {
        player.pendingLots = next.lotDeck.splice(0, draw);
      }
      log(
        `— ${1964 + next.round} — dealt ${draw} building cards each, keep ${keep}.`,
      );
      return next;
    }

    case 'KEEP_LOTS': {
      const player = next.players.find((p) => p.id === action.player);
      if (!player || next.phase !== 'keep') return state;

      const { keep } = dealFor(next.players.length, next.round);
      const chosen = [...new Set(action.lots)];
      if (chosen.length !== Math.min(keep, player.pendingLots.length)) {
        return state;
      }
      if (!chosen.every((l) => player.pendingLots.includes(l))) return state;

      for (const lot of chosen) {
        player.lots.push(lot);
        next.ownership[lot] = player.id;
      }
      // Discards go back into the pile for next round.
      const discarded = player.pendingLots.filter((l) => !chosen.includes(l));
      next.lotDeck.push(...discarded);
      player.pendingLots = [];
      log(
        `${player.name} kept ${chosen.length} building${
          chosen.length === 1 ? '' : 's'
        } and discarded ${discarded.length}.`,
      );

      if (next.players.every((p) => p.pendingLots.length === 0)) {
        next.seed = (next.seed * 1664525 + 1013904223) >>> 0;
        next.lotDeck = shuffle(next.lotDeck, mulberry32(next.seed));

        // Phase 2: only now, with every building committed, are shop tiles
        // drawn from the bag. They are revealed to everyone at once so
        // trading can start simultaneously.
        const { shops } = dealFor(next.players.length, next.round);
        let short = false;
        for (const drawing of next.players) {
          for (let i = 0; i < shops; i++) {
            const tile = next.tileDeck.shift();
            if (!tile) {
              short = true;
              break;
            }
            drawing.tiles.push(tile.id);
          }
        }

        next.phase = 'negotiate';
        log(
          `All buildings claimed. ${shops} shop tiles drawn each — negotiation is open.`,
        );
        if (short) log('The shop bag ran out.');
      }
      return next;
    }

    case 'SET_ACTING_PLAYER':
      next.activePlayer = action.index;
      return next;

    case 'CREATE_DEAL': {
      const deal: Deal = {
        id: next.nextDealId++,
        items: [],
        promises: [],
        confirmed: [],
        status: 'open',
      };
      next.deals.unshift(deal);
      return next;
    }

    case 'ADD_DEAL_ITEM': {
      const deal = findDeal(action.dealId);
      if (!deal) return state;
      deal.items.push(action.item);
      deal.confirmed = []; // any edit invalidates every confirmation
      return next;
    }

    case 'REMOVE_DEAL_ITEM': {
      const deal = findDeal(action.dealId);
      if (!deal) return state;
      deal.items.splice(action.index, 1);
      deal.confirmed = [];
      return next;
    }

    case 'ADD_PROMISE': {
      const deal = findDeal(action.dealId);
      if (!deal) return state;
      deal.promises.push(action.promise);
      deal.confirmed = [];
      return next;
    }

    case 'SET_CONFIRM': {
      const deal = findDeal(action.dealId);
      if (!deal) return state;

      deal.confirmed = action.confirmed
        ? [...new Set([...deal.confirmed, action.player])]
        : deal.confirmed.filter((p) => p !== action.player);

      if (!allPartiesConfirmed(deal)) return next;

      // Everyone is in — validate against live state and commit atomically.
      const problems = validateDeal(deal, next);
      if (problems.length > 0) {
        deal.confirmed = [];
        log(`Deal #${deal.id} failed: ${problems[0]}`);
        return next;
      }

      applyDeal(deal, next);
      deal.status = 'executed';
      log(
        `Deal #${deal.id} executed between ${dealParties(deal)
          .map(nameOf)
          .join(', ')}.`,
      );
      for (const promise of deal.promises) {
        log(
          `  IOU (not enforced) ${nameOf(promise.from)} → ${nameOf(
            promise.to,
          )}: "${promise.text}"`,
        );
      }
      return next;
    }

    case 'CANCEL_DEAL': {
      const deal = findDeal(action.dealId);
      if (!deal) return state;
      deal.status = 'cancelled';
      return next;
    }

    case 'PLACE_TILE': {
      const player = next.players.find((p) => p.id === action.player);
      if (!player) return state;
      if (!player.lots.includes(action.lot)) return state;
      if (!player.tiles.includes(action.tile)) return state;
      if (next.placements[action.lot]) return state;

      const tileType = tileTypeOf(action.tile);
      if (!tileType) return state;

      // The building stays owned; it just stops being a vacant lot. Shop
      // tiles can never be moved or removed once placed.
      player.lots = player.lots.filter((l) => l !== action.lot);
      player.tiles = player.tiles.filter((t) => t !== action.tile);
      next.placements[action.lot] = {
        lot: action.lot,
        tile: action.tile,
        type: tileType,
        owner: player.id,
      };
      log(
        `${player.name} built ${BUSINESS_BY_ID[tileType].name} on building ${action.lot}.`,
      );
      return next;
    }

    case 'SET_READY': {
      if (!next.players.some((p) => p.id === action.player)) return state;
      if (next.phase !== 'negotiate' && next.phase !== 'build') return state;

      next.ready = action.ready
        ? [...new Set([...next.ready, action.player])]
        : next.ready.filter((p) => p !== action.player);

      // Nobody's phase ends until everyone agrees to move on.
      if (next.players.every((p) => next.ready.includes(p.id))) {
        if (next.phase === 'negotiate') closeNegotiation(next, log);
        else collectIncome(next, log);
      }
      return next;
    }

    case 'END_NEGOTIATION':
      closeNegotiation(next, log);
      return next;

    case 'END_BUILD':
      collectIncome(next, log);
      return next;

    default:
      return state;
  }
}

/** Tile ids are never reused, so the type can be recovered from the original
 *  deck ordering even after the tile has left the deck. */
export function tileTypeOf(tileId: string): string | undefined {
  const index = Number(tileId.slice(1));
  let cursor = 0;
  for (const type of BUSINESS_TYPES) {
    if (index < cursor + type.deckCount) return type.id;
    cursor += type.deckCount;
  }
  return undefined;
}
