import type { BusinessType } from './types';

/* ========================================================================
 * Game data.
 *
 * Sourced from github.com/sheki/chinatown (a working fan implementation:
 * ReasonReact front end, Go backend) — its HelpBoard payout chart, shop.go
 * tile counts and state.go setup constants. That is second-hand rather than
 * the official rulebook, so it may carry that author's own errors, but it is
 * a real playtested implementation and is far better than guesswork.
 *
 * Still unverified — see README:
 *   - 3- and 5-player deal counts (that implementation is 4-player only)
 *   - whether the lot deck is meant to run out (see LOTS_PER_ROUND)
 *
 * Money is in thousands ($50 = $50,000).
 * ===================================================================== */

export const STARTING_MONEY = 50;
export const MAX_ROUNDS = 6;

/* Income does NOT vary by business type. It depends only on how many tiles
 * the business has and whether that makes it complete. This is the heart of
 * the game's tension: a finished 3-tile Tea shop ($50k) beats a stalled
 * 3-tile Restaurant ($40k), but a finished Restaurant is worth $140k. */

/** Payout for a business that has not reached its type's max size. */
export const INCOMPLETE_INCOME: Record<number, number> = {
  1: 10,
  2: 20,
  3: 40,
  4: 60,
  5: 80,
};

/** Payout for a business built out to its type's max size. */
export const COMPLETE_INCOME: Record<number, number> = {
  3: 50,
  4: 80,
  5: 110,
  6: 140,
};

export function businessIncome(size: number, maxSize: number): number {
  const tiles = Math.min(size, maxSize);
  return tiles >= maxSize
    ? (COMPLETE_INCOME[maxSize] ?? 0)
    : (INCOMPLETE_INCOME[tiles] ?? 0);
}

/** Tiles of each type in the deck, by the type's size. */
const DECK_COUNT_BY_SIZE: Record<number, number> = { 3: 6, 4: 7, 5: 8, 6: 9 };

function type_(
  id: string,
  name: string,
  emoji: string,
  maxSize: number,
  color: string,
): BusinessType {
  return {
    id,
    name,
    emoji,
    maxSize,
    deckCount: DECK_COUNT_BY_SIZE[maxSize],
    color,
  };
}

/** The 12 businesses, grouped by size. 90 tiles total.
 *  Names, sizes and counts confirmed against a photo of the retail tiles.
 *  Order is load-bearing: tile ids are handed out by walking this list. */
export const BUSINESS_TYPES: BusinessType[] = [
  type_('restaurant', 'Restaurant', '🍜', 6, '#9b2c2c'),
  type_('antiques', 'Antiques', '🏺', 6, '#8e5a2b'),
  type_('factory', 'Factory', '🏭', 6, '#4a5568'),

  type_('dimsum', 'Dim Sum', '🥟', 5, '#e67e22'),
  type_('laundry', 'Laundry', '🧺', 5, '#2980b9'),
  type_('takeout', 'Take Out', '🥡', 5, '#c0392b'),

  type_('tropicalfish', 'Tropical Fish', '🐠', 4, '#2c7a7b'),
  type_('florist', 'Florist', '🌸', 4, '#b83280'),
  type_('jewellery', 'Jewellery', '💍', 4, '#b7791f'),

  type_('photo', 'Photo', '📷', 3, '#553c9a'),
  type_('teahouse', 'Tea House', '🍵', 3, '#276749'),
  type_('seafood', 'Sea Food', '🦐', 3, '#3182ce'),
];

export const BUSINESS_BY_ID: Record<string, BusinessType> = Object.fromEntries(
  BUSINESS_TYPES.map((b) => [b.id, b]),
);

/** Building cards are dealt draw-then-keep: a player receives `draw` cards,
 *  keeps `keep` of their choice, and the rest go back into the pile to be
 *  reshuffled. Choosing what to keep is a real decision — it is the first
 *  place adjacency gets fought over.
 *
 *  `shops` is a separate allocation off the player aid: how many shop tiles
 *  that player draws from the bag that round. Unlike building cards, shop
 *  tiles are never discarded or returned, so the 90 tiles are a hard cap. */
export interface RoundDeal {
  draw: number;
  keep: number;
  shops: number;
}

const deal_ = (draw: number, keep: number, shops: number): RoundDeal => ({
  draw,
  keep,
  shops,
});

/** [playerCount][round] — index 0 unused so rounds read 1-6. */
export const DEAL_TABLE: Record<number, RoundDeal[]> = {
  3: [
    deal_(0, 0, 0),
    deal_(7, 5, 7),
    deal_(6, 4, 4),
    deal_(6, 4, 4),
    deal_(6, 4, 4),
    deal_(6, 4, 4),
    deal_(6, 4, 4),
  ],
  4: [
    deal_(0, 0, 0),
    deal_(6, 4, 6),
    deal_(5, 3, 3),
    deal_(5, 3, 3),
    deal_(5, 3, 3),
    deal_(5, 3, 3),
    deal_(5, 3, 3),
  ],
  5: [
    deal_(0, 0, 0),
    deal_(5, 3, 5),
    deal_(5, 3, 3),
    deal_(5, 3, 3),
    deal_(4, 2, 2),
    deal_(4, 2, 2),
    deal_(4, 2, 2),
  ],
};

export function dealFor(playerCount: number, round: number): RoundDeal {
  return DEAL_TABLE[playerCount]?.[round] ?? deal_(0, 0, 0);
}

/** Total buildings kept, and shop tiles drawn, across a whole game. Used to
 *  check the tables against the 85 buildings and 90 tiles that exist. */
export function gameDemand(playerCount: number): {
  buildings: number;
  shops: number;
} {
  const rounds = DEAL_TABLE[playerCount]?.slice(1) ?? [];
  return {
    buildings: rounds.reduce((sum, r) => sum + r.keep, 0) * playerCount,
    shops: rounds.reduce((sum, r) => sum + r.shops, 0) * playerCount,
  };
}

export const PLAYER_COLORS = [
  '#e74c3c',
  '#3498db',
  '#2ecc71',
  '#f1c40f',
  '#9b59b6',
];
