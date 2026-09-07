import assert from 'node:assert/strict';
import test from 'node:test';

import { LOT_BY_ID, LOTS, NEIGHBOURS } from './board';
import { createGame, reduce, type Action } from './game';
import { findBusinesses, incomeFor } from './income';
import {
  BUSINESS_BY_ID,
  BUSINESS_TYPES,
  COMPLETE_INCOME,
  INCOMPLETE_INCOME,
  businessIncome,
  dealFor,
  gameDemand,
} from './rules';
import type { GameState } from './types';
import { leaksMoney, viewFor } from './view';

/* Tile ids are handed out by walking BUSINESS_TYPES in order, so these are
 * the first tiles of each type in a fresh deck. */
const RESTAURANT = ['t0', 't1', 't2', 't3']; // max size 6
const LAUNDRY = ['t35', 't36']; // max size 5
const PHOTO = ['t72', 't73', 't74', 't75', 't76']; // max size 3
const SEAFOOD = ['t84', 't85', 't86']; // max size 3

/* Lots 1, 2 and 3 sit in zone 0 at (1,0), (2,0) and (1,1): 1 touches both. */
const TRIANGLE = [1, 2, 3];
/* Lots 1-5 form one connected run in zone 0. */
const RUN_OF_FIVE = [1, 2, 3, 4, 5];

function seeded(): GameState {
  return createGame(['Ann', 'Ben', 'Cai'], 1);
}

/** Puts specific lots and tiles in a player's hand, bypassing the deal step. */
function grant(
  state: GameState,
  playerIndex: number,
  lots: number[],
  tiles: string[],
): void {
  const player = state.players[playerIndex];
  player.lots = [...lots];
  player.tiles = [...tiles];
  for (const lot of lots) state.ownership[lot] = player.id;
}

function run(state: GameState, actions: Action[]): GameState {
  return actions.reduce(reduce, state);
}

/** Every player keeps the first N of the cards they drew. */
function keepAll(state: GameState): GameState {
  let current = state;
  const { keep } = dealFor(state.players.length, state.round);
  for (const { id } of state.players) {
    const player = current.players.find((p) => p.id === id)!;
    current = reduce(current, {
      type: 'KEEP_LOTS',
      player: id,
      lots: player.pendingLots.slice(
        0,
        Math.min(keep, player.pendingLots.length),
      ),
    });
  }
  return current;
}

/** A whole round with no trading and no building. */
function playRound(state: GameState): GameState {
  let current = run(state, [{ type: 'START_ROUND' }]);
  current = keepAll(current);
  return run(current, [{ type: 'END_NEGOTIATION' }, { type: 'END_BUILD' }]);
}

/* ---------- board ---------------------------------------------------- */

test('the board has 85 lots, numbered 1 to 85 with no gaps', () => {
  assert.equal(LOTS.length, 85);
  const ids = LOTS.map((l) => l.id).sort((a, b) => a - b);
  assert.deepEqual(ids, Array.from({ length: 85 }, (_, i) => i + 1));
});

test('no adjacency crosses a street', () => {
  for (const lot of LOTS) {
    for (const neighbourId of NEIGHBOURS[lot.id]) {
      const neighbour = LOT_BY_ID[neighbourId];
      assert.equal(
        neighbour.block,
        lot.block,
        `lot ${lot.id} wrongly connects to ${neighbourId} across a street`,
      );
      const distance =
        Math.abs(neighbour.x - lot.x) + Math.abs(neighbour.y - lot.y);
      assert.equal(distance, 1, 'neighbours must be orthogonally touching');
    }
  }
});

test('adjacency is symmetric', () => {
  for (const lot of LOTS) {
    for (const neighbourId of NEIGHBOURS[lot.id]) {
      assert.ok(
        NEIGHBOURS[neighbourId].includes(lot.id),
        `${lot.id} → ${neighbourId} is not mirrored`,
      );
    }
  }
});

test('no two lots share a square', () => {
  const coords = new Set(LOTS.map((l) => `${l.x},${l.y}`));
  assert.equal(coords.size, LOTS.length);
});

/* ---------- deck ----------------------------------------------------- */

test('every type has three more tiles than its maximum size', () => {
  // The rulebook's rule, and where the 90 comes from: sizes 3/4/5/6 give
  // 6/7/8/9 tiles, three types at each size, so (6+7+8+9) x 3 = 90.
  for (const type of BUSINESS_TYPES) {
    assert.equal(
      type.deckCount,
      type.maxSize + 3,
      `${type.name} should have ${type.maxSize + 3} tiles`,
    );
  }
});

test('the bag holds 90 tiles across 12 businesses, three at each size', () => {
  assert.equal(BUSINESS_TYPES.length, 12);
  const total = BUSINESS_TYPES.reduce((sum, t) => sum + t.deckCount, 0);
  assert.equal(total, 90);
  for (const size of [3, 4, 5, 6]) {
    assert.equal(BUSINESS_TYPES.filter((t) => t.maxSize === size).length, 3);
  }
});

test('there are more tiles than buildings, on purpose', () => {
  // 90 businesses for 85 locations. The surplus is what guarantees no type
  // can ever become impossible to complete.
  const total = BUSINESS_TYPES.reduce((sum, t) => sum + t.deckCount, 0);
  assert.equal(LOTS.length, 85);
  assert.ok(total > LOTS.length);
  // Even a complete business of every type at once fits on the board.
  const oneOfEach = BUSINESS_TYPES.reduce((sum, t) => sum + t.maxSize, 0);
  assert.ok(oneOfEach <= LOTS.length, `${oneOfEach} tiles vs ${LOTS.length}`);
});

/* ---------- income --------------------------------------------------- */

test('income depends on size and completion, not on business type', () => {
  // A Photo shop and a Tea shop are both size 3 and pay identically.
  assert.equal(businessIncome(3, 3), businessIncome(3, 3));
  assert.equal(businessIncome(3, 3), COMPLETE_INCOME[3]);
  // Three tiles of a size-6 Restaurant is an unfinished business.
  assert.equal(businessIncome(3, 6), INCOMPLETE_INCOME[3]);
});

test('finishing a small business beats stalling a large one', () => {
  const finishedTea = businessIncome(3, 3); // 50
  const stalledRestaurant = businessIncome(3, 6); // 40
  assert.ok(finishedTea > stalledRestaurant);
});

test('but a finished large business dwarfs a finished small one', () => {
  assert.ok(businessIncome(6, 6) > businessIncome(3, 3) * 2);
});

test('a run longer than the maximum splits into separate businesses', () => {
  // Five adjacent Photo shops (max 3) are a complete 3 plus a separate 2,
  // NOT one capped business — worth 50 + 20, not 50.
  let state = seeded();
  grant(state, 0, RUN_OF_FIVE, PHOTO);
  state = run(
    state,
    RUN_OF_FIVE.map((lot, i) => ({
      type: 'PLACE_TILE' as const,
      player: 'p0',
      tile: PHOTO[i],
      lot,
    })),
  );

  const businesses = findBusinesses(state);
  assert.equal(businesses.length, 2);
  assert.deepEqual(
    businesses.map((b) => b.size).sort(),
    [2, 3],
  );
  assert.equal(businesses.filter((b) => b.complete).length, 1);
  assert.equal(
    incomeFor(state, 'p0'),
    COMPLETE_INCOME[3] + INCOMPLETE_INCOME[2],
  );
});

/* ---------- businesses on the board ---------------------------------- */

test('adjacent same-type tiles merge into one business', () => {
  let state = seeded();
  grant(state, 0, TRIANGLE, RESTAURANT.slice(0, 3));
  state = run(
    state,
    TRIANGLE.map((lot, i) => ({
      type: 'PLACE_TILE' as const,
      player: 'p0',
      tile: RESTAURANT[i],
      lot,
    })),
  );

  const businesses = findBusinesses(state);
  assert.equal(businesses.length, 1);
  assert.equal(businesses[0].size, 3);
  assert.equal(businesses[0].complete, false); // a restaurant needs 6
  assert.equal(businesses[0].income, INCOMPLETE_INCOME[3]);
});

test('the same three lots complete a Sea Food shop and pay more', () => {
  let state = seeded();
  grant(state, 0, TRIANGLE, SEAFOOD);
  state = run(
    state,
    TRIANGLE.map((lot, i) => ({
      type: 'PLACE_TILE' as const,
      player: 'p0',
      tile: SEAFOOD[i],
      lot,
    })),
  );

  const [business] = findBusinesses(state);
  assert.equal(business.complete, true);
  assert.equal(business.income, COMPLETE_INCOME[3]);
  assert.ok(business.income > INCOMPLETE_INCOME[3]);
});

test('lots in different zones never form one business', () => {
  // Lot 2 is in zone 0, lot 16 in zone 1.
  assert.notEqual(LOT_BY_ID[2].block, LOT_BY_ID[16].block);

  let state = seeded();
  grant(state, 0, [2, 16], RESTAURANT.slice(0, 2));
  state = run(state, [
    { type: 'PLACE_TILE', player: 'p0', tile: 't0', lot: 2 },
    { type: 'PLACE_TILE', player: 'p0', tile: 't1', lot: 16 },
  ]);

  const businesses = findBusinesses(state);
  assert.equal(businesses.length, 2);
  assert.ok(businesses.every((b) => b.size === 1));
});

test('different owners on adjacent lots do not merge', () => {
  let state = seeded();
  grant(state, 0, [1], [RESTAURANT[0]]);
  grant(state, 1, [2], [RESTAURANT[1]]);
  state = run(state, [
    { type: 'PLACE_TILE', player: 'p0', tile: 't0', lot: 1 },
    { type: 'PLACE_TILE', player: 'p1', tile: 't1', lot: 2 },
  ]);

  assert.equal(findBusinesses(state).length, 2);
});

test('different types on adjacent lots do not merge', () => {
  let state = seeded();
  grant(state, 0, [1, 2], [RESTAURANT[0], SEAFOOD[0]]);
  state = run(state, [
    { type: 'PLACE_TILE', player: 'p0', tile: RESTAURANT[0], lot: 1 },
    { type: 'PLACE_TILE', player: 'p0', tile: SEAFOOD[0], lot: 2 },
  ]);

  assert.equal(findBusinesses(state).length, 2);
});

/* ---------- trading -------------------------------------------------- */

test('three-way deal executes atomically once everyone confirms', () => {
  let state = seeded();
  grant(state, 0, [1], []); // Ann holds lot 1
  grant(state, 1, [], [LAUNDRY[0]]); // Ben holds a laundry tile
  const startMoney = state.players[2].money;

  state = run(state, [
    { type: 'CREATE_DEAL' },
    {
      type: 'ADD_DEAL_ITEM',
      dealId: 1,
      item: { kind: 'lot', from: 'p0', to: 'p1', lot: 1 },
    },
    {
      type: 'ADD_DEAL_ITEM',
      dealId: 1,
      item: { kind: 'tile', from: 'p1', to: 'p2', tile: LAUNDRY[0] },
    },
    {
      type: 'ADD_DEAL_ITEM',
      dealId: 1,
      item: { kind: 'cash', from: 'p2', to: 'p0', amount: 8 },
    },
    { type: 'SET_CONFIRM', dealId: 1, player: 'p0', confirmed: true },
    { type: 'SET_CONFIRM', dealId: 1, player: 'p1', confirmed: true },
  ]);

  // Two of three: nothing has moved yet.
  assert.equal(state.deals[0].status, 'open');
  assert.deepEqual(state.players[0].lots, [1]);
  assert.equal(state.players[2].money, startMoney);

  state = run(state, [
    { type: 'SET_CONFIRM', dealId: 1, player: 'p2', confirmed: true },
  ]);

  assert.equal(state.deals[0].status, 'executed');
  assert.deepEqual(state.players[0].lots, []);
  assert.deepEqual(state.players[1].lots, [1]);
  assert.equal(state.ownership[1], 'p1');
  assert.deepEqual(state.players[2].tiles, [LAUNDRY[0]]);
  assert.equal(state.players[2].money, startMoney - 8);
});

test('editing a deal clears every confirmation', () => {
  let state = seeded();
  grant(state, 0, [1], []);
  state = run(state, [
    { type: 'CREATE_DEAL' },
    {
      type: 'ADD_DEAL_ITEM',
      dealId: 1,
      item: { kind: 'lot', from: 'p0', to: 'p1', lot: 1 },
    },
    { type: 'SET_CONFIRM', dealId: 1, player: 'p0', confirmed: true },
  ]);
  assert.deepEqual(state.deals[0].confirmed, ['p0']);

  state = run(state, [
    {
      type: 'ADD_DEAL_ITEM',
      dealId: 1,
      item: { kind: 'cash', from: 'p1', to: 'p0', amount: 3 },
    },
  ]);
  assert.deepEqual(state.deals[0].confirmed, []);
});

test('a deal that went stale fails as a whole', () => {
  let state = seeded();
  grant(state, 0, [1], []);

  // Two deals both promise lot 1; assets are deliberately not locked.
  state = run(state, [
    { type: 'CREATE_DEAL' },
    {
      type: 'ADD_DEAL_ITEM',
      dealId: 1,
      item: { kind: 'lot', from: 'p0', to: 'p1', lot: 1 },
    },
    { type: 'CREATE_DEAL' },
    {
      type: 'ADD_DEAL_ITEM',
      dealId: 2,
      item: { kind: 'lot', from: 'p0', to: 'p2', lot: 1 },
    },
    // Deal 1 commits first and takes the lot.
    { type: 'SET_CONFIRM', dealId: 1, player: 'p0', confirmed: true },
    { type: 'SET_CONFIRM', dealId: 1, player: 'p1', confirmed: true },
    // Deal 2 now has nothing to give.
    { type: 'SET_CONFIRM', dealId: 2, player: 'p0', confirmed: true },
    { type: 'SET_CONFIRM', dealId: 2, player: 'p2', confirmed: true },
  ]);

  const deal2 = state.deals.find((d) => d.id === 2)!;
  assert.equal(deal2.status, 'open', 'stale deal must not execute');
  assert.deepEqual(deal2.confirmed, [], 'failed deal resets confirmations');
  assert.equal(state.ownership[1], 'p1', 'first deal still stands');
  assert.ok(state.log.some((l) => l.includes('failed')));
});

test('a player cannot pay more than they hold', () => {
  let state = seeded();
  state = run(state, [
    { type: 'CREATE_DEAL' },
    {
      type: 'ADD_DEAL_ITEM',
      dealId: 1,
      item: { kind: 'cash', from: 'p0', to: 'p1', amount: 9999 },
    },
    { type: 'SET_CONFIRM', dealId: 1, player: 'p0', confirmed: true },
    { type: 'SET_CONFIRM', dealId: 1, player: 'p1', confirmed: true },
  ]);

  assert.equal(state.deals[0].status, 'open');
  assert.equal(state.players[1].money, 50);
});

test('a building can be traded with its shop still standing', () => {
  let state = seeded();
  grant(state, 0, [1, 2], RESTAURANT.slice(0, 2)); // Ann
  grant(state, 1, [3], [RESTAURANT[2]]); // Ben, adjacent to lot 1
  state = run(state, [
    { type: 'PLACE_TILE', player: 'p0', tile: RESTAURANT[0], lot: 1 },
    { type: 'PLACE_TILE', player: 'p0', tile: RESTAURANT[1], lot: 2 },
    { type: 'PLACE_TILE', player: 'p1', tile: RESTAURANT[2], lot: 3 },
  ]);

  // Adjacent, same type, different owners: two businesses, not one.
  assert.equal(findBusinesses(state).length, 2);
  assert.equal(incomeFor(state, 'p0'), INCOMPLETE_INCOME[2]);
  assert.equal(incomeFor(state, 'p1'), INCOMPLETE_INCOME[1]);

  // Ben sells the built building to Ann.
  state = run(state, [
    { type: 'CREATE_DEAL' },
    {
      type: 'ADD_DEAL_ITEM',
      dealId: 1,
      item: { kind: 'lot', from: 'p1', to: 'p0', lot: 3 },
    },
    {
      type: 'ADD_DEAL_ITEM',
      dealId: 1,
      item: { kind: 'cash', from: 'p0', to: 'p1', amount: 15 },
    },
    { type: 'SET_CONFIRM', dealId: 1, player: 'p0', confirmed: true },
    { type: 'SET_CONFIRM', dealId: 1, player: 'p1', confirmed: true },
  ]);

  assert.equal(state.deals[0].status, 'executed');
  // The shop never moved; only the ownership marker did.
  assert.equal(state.placements[3].owner, 'p0');
  assert.equal(state.placements[3].tile, RESTAURANT[2]);
  assert.equal(state.ownership[3], 'p0');
  // The two businesses have merged into one of size 3.
  const merged = findBusinesses(state);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].size, 3);
  assert.equal(incomeFor(state, 'p0'), INCOMPLETE_INCOME[3]);
  assert.equal(incomeFor(state, 'p1'), 0);
});

test('a built building cannot be traded by someone who does not own it', () => {
  let state = seeded();
  grant(state, 0, [1], [RESTAURANT[0]]);
  state = run(state, [
    { type: 'PLACE_TILE', player: 'p0', tile: RESTAURANT[0], lot: 1 },
    { type: 'CREATE_DEAL' },
    {
      type: 'ADD_DEAL_ITEM',
      dealId: 1,
      item: { kind: 'lot', from: 'p1', to: 'p2', lot: 1 },
    },
    { type: 'SET_CONFIRM', dealId: 1, player: 'p1', confirmed: true },
    { type: 'SET_CONFIRM', dealId: 1, player: 'p2', confirmed: true },
  ]);

  assert.equal(state.deals[0].status, 'open');
  assert.equal(state.placements[1].owner, 'p0');
});

/* ---------- rounds --------------------------------------------------- */

test('buildings are dealt draw-then-keep, and discards go back', () => {
  let state = seeded();
  const { draw, keep, shops } = dealFor(3, 1);
  assert.deepEqual({ draw, keep, shops }, { draw: 7, keep: 5, shops: 7 });

  state = run(state, [{ type: 'START_ROUND' }]);
  assert.equal(state.phase, 'keep');
  assert.equal(state.players[0].pendingLots.length, draw);
  assert.equal(state.players[0].lots.length, 0);
  assert.equal(state.lotDeck.length, 85 - draw * 3);

  state = keepAll(state);
  assert.equal(state.phase, 'negotiate');
  for (const player of state.players) {
    assert.equal(player.lots.length, keep);
    assert.equal(player.pendingLots.length, 0);
    assert.equal(player.tiles.length, shops);
    for (const lot of player.lots) {
      assert.equal(state.ownership[lot], player.id);
    }
  }
  // 2 discards per player returned to the pile.
  assert.equal(state.lotDeck.length, 85 - keep * 3);
});

test('shop tiles are not drawn until every building is committed', () => {
  // Rulebook phase order: deal Building cards, THEN draw Shop tiles, THEN
  // trade. Seeing your shops early would make the keep decision far easier.
  let state = seeded();
  state = run(state, [{ type: 'START_ROUND' }]);

  assert.equal(state.tileDeck.length, 90, 'the bag is untouched during keep');
  for (const player of state.players) {
    assert.equal(player.tiles.length, 0, 'no shops while choosing buildings');
  }

  // One player choosing is not enough to release the tiles.
  const first = state.players[0];
  state = reduce(state, {
    type: 'KEEP_LOTS',
    player: first.id,
    lots: first.pendingLots.slice(0, 5),
  });
  assert.equal(state.phase, 'keep');
  assert.equal(state.tileDeck.length, 90, 'still untouched');
  assert.equal(state.players[0].tiles.length, 0);

  state = keepAll(state);
  assert.equal(state.phase, 'negotiate');
  const { shops } = dealFor(3, 1);
  assert.equal(state.tileDeck.length, 90 - shops * 3);
  for (const player of state.players) {
    assert.equal(player.tiles.length, shops);
  }
});

test('keeping the wrong number of buildings is rejected', () => {
  let state = seeded();
  state = run(state, [{ type: 'START_ROUND' }]);
  const drawn = state.players[0].pendingLots;

  const tooFew = reduce(state, {
    type: 'KEEP_LOTS',
    player: 'p0',
    lots: drawn.slice(0, 2),
  });
  assert.equal(tooFew.players[0].pendingLots.length, drawn.length);

  const notDrawn = reduce(state, {
    type: 'KEEP_LOTS',
    player: 'p0',
    lots: [...drawn.slice(0, 4), 999],
  });
  assert.equal(notDrawn.players[0].pendingLots.length, drawn.length);
});

test('every player count fits inside the 85 buildings', () => {
  for (const players of [3, 4, 5]) {
    const { buildings } = gameDemand(players);
    assert.ok(
      buildings <= 85,
      `${players} players would need ${buildings} of 85 buildings`,
    );
  }
});

test('every player count fits inside the 90 shop tiles', () => {
  // All three rows land just under the cap, which is what a tuned table
  // should do: 81, 84 and 85 of 90.
  assert.deepEqual(
    [3, 4, 5].map((players) => gameDemand(players).shops),
    [81, 84, 85],
  );
  for (const players of [3, 4, 5]) {
    const { shops } = gameDemand(players);
    assert.ok(
      shops <= 90,
      `${players} players would need ${shops} of 90 shop tiles`,
    );
  }
});

test('the shop bag is never drawn past empty', () => {
  let state = createGame(['A', 'B', 'C', 'D', 'E'], 7);
  for (let round = 0; round < 6; round++) state = playRound(state);
  assert.ok(state.tileDeck.length >= 0);
  const held = state.players.reduce((sum, p) => sum + p.tiles.length, 0);
  const placed = Object.keys(state.placements).length;
  assert.equal(held + placed + state.tileDeck.length, 90, 'no tiles conjured');
});

test('income is paid at the end of a round', () => {
  let state = seeded();
  state = keepAll(run(state, [{ type: 'START_ROUND' }]));
  grant(state, 0, [1, 2], LAUNDRY);
  state = run(state, [
    { type: 'PLACE_TILE', player: 'p0', tile: LAUNDRY[0], lot: 1 },
    { type: 'PLACE_TILE', player: 'p0', tile: LAUNDRY[1], lot: 2 },
  ]);

  const expected = incomeFor(state, 'p0');
  assert.equal(expected, INCOMPLETE_INCOME[2]);

  const before = state.players[0].money;
  state = run(state, [{ type: 'END_NEGOTIATION' }, { type: 'END_BUILD' }]);
  assert.equal(state.players[0].money, before + expected);
});

test('the lot deck survives all six rounds', () => {
  let state = seeded();
  for (let round = 0; round < 6; round++) state = playRound(state);
  assert.ok(state.lotDeck.length > 0, 'the pile should never run dry');
  const owned = Object.keys(state.ownership).length;
  assert.equal(owned + state.lotDeck.length, 85, 'no buildings lost');
});

test('the game ends after the final round', () => {
  let state = seeded();
  for (let round = 0; round < 6; round++) state = playRound(state);
  assert.equal(state.round, 6);
  assert.equal(state.phase, 'gameover');
  assert.ok(state.log.some((l) => l.includes('wins')));
});

test('every business type is reachable from a fresh deck', () => {
  const state = seeded();
  const types = new Set(state.tileDeck.map((t) => t.type));
  assert.equal(types.size, 12);
  for (const type of BUSINESS_TYPES) {
    assert.ok(BUSINESS_BY_ID[type.id], `${type.id} missing from lookup`);
  }
});

test('money is secret during play and revealed at the end', () => {
  const playing = run(seeded(), [{ type: 'START_ROUND' }]);
  const mid = viewFor(playing, 'p0');
  assert.equal(mid.players.find((p) => p.id === 'p0')!.money, 50, 'own balance');
  assert.equal(mid.players.find((p) => p.id === 'p1')!.money, undefined);
  assert.equal(leaksMoney(mid, 'p0'), false);

  let finished = seeded();
  for (let round = 0; round < 6; round++) finished = playRound(finished);
  assert.equal(finished.phase, 'gameover');

  // Everyone counts up at the end, so the winner is actually visible.
  const final = viewFor(finished, 'p0');
  assert.ok(
    final.players.every((p) => typeof p.money === 'number'),
    'every balance is revealed once the game is over',
  );
});
