export type PlayerId = string;
export type LotId = number;
export type TileId = string;
export type BusinessTypeId = string;

/** A single building lot on the board. Lots in the same block can be adjacent;
 *  lots in different blocks are separated by a street and never connect. */
export interface Lot {
  id: LotId;
  block: number;
  x: number;
  y: number;
}

export interface BusinessType {
  id: BusinessTypeId;
  name: string;
  emoji: string;
  /** Tiles needed for a complete business of this type. Income depends on
   *  this only through whether a business counts as complete. */
  maxSize: number;
  /** How many tiles of this type exist in the deck. */
  deckCount: number;
  color: string;
}

export interface Tile {
  id: TileId;
  type: BusinessTypeId;
}

export interface Player {
  id: PlayerId;
  name: string;
  color: string;
  money: number;
  /** Buildings owned but not yet built on. Buildings that have a shop are
   *  tracked in `ownership`/`placements` instead — both can be traded. */
  lots: LotId[];
  /** Business tiles in hand. */
  tiles: TileId[];
  /** Building cards drawn this round, awaiting the keep/discard choice. */
  pendingLots: LotId[];
}

export interface Placement {
  lot: LotId;
  tile: TileId;
  type: BusinessTypeId;
  owner: PlayerId;
}

/** A connected group of same-type tiles owned by one player. */
export interface Business {
  owner: PlayerId;
  type: BusinessTypeId;
  lots: LotId[];
  size: number;
  complete: boolean;
  income: number;
}

export type Phase =
  | 'setup'
  /** Cards are dealt; every player must discard down to their keep count. */
  | 'keep'
  | 'negotiate'
  | 'build'
  | 'income'
  | 'gameover';

/* ---------- Trading ----------------------------------------------------- */

/** One directed transfer inside a deal. Deals are a flat list of these, which
 *  is what lets a single deal span any number of players. */
export type DealItem =
  | { kind: 'lot'; from: PlayerId; to: PlayerId; lot: LotId }
  | { kind: 'tile'; from: PlayerId; to: PlayerId; tile: TileId }
  | { kind: 'cash'; from: PlayerId; to: PlayerId; amount: number };

/** Non-binding side agreements ("I'll give you a restaurant tile next round").
 *  Recorded and shown publicly, never enforced by the engine. */
export interface Promise_ {
  from: PlayerId;
  to: PlayerId;
  text: string;
}

export interface Deal {
  id: number;
  items: DealItem[];
  promises: Promise_[];
  /** Players who have confirmed the deal *in its current form*. Any edit
   *  clears this list. */
  confirmed: PlayerId[];
  status: 'open' | 'executed' | 'cancelled';
}

export interface GameState {
  round: number;
  maxRounds: number;
  phase: Phase;
  players: Player[];
  /** lot id -> owning player */
  ownership: Record<LotId, PlayerId>;
  /** lot id -> what is built there */
  placements: Record<LotId, Placement>;
  lotDeck: LotId[];
  tileDeck: Tile[];
  /** Index into players[] for the player currently acting in build phase. */
  activePlayer: number;
  deals: Deal[];
  nextDealId: number;
  /** Players who have agreed to move on from the current phase. The rulebook
   *  has no timer: negotiation ends when everyone agrees. Cleared on every
   *  phase change. */
  ready: PlayerId[];
  /** Advanced on each reshuffle so shuffles stay reproducible. */
  seed: number;
  log: string[];
}
