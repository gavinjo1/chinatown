# I vibe code this, thank u claude

An online version of **Chinatown**, the 1999 negotiation board game by Karsten
Hartwig. New York Chinatown, 1965–1970. 3–5 players, six rounds, and the whole
game is people arguing over who gets which building.

## Run it

```bash
npm install
npm run server   # game server on :8787
npm run dev      # client on :5173
```

Open http://localhost:5173, create a room, share the `/r/CODE` link.
Or go to `/hotseat` to play everyone from one screen with no server.

```bash
npm test         # 52 tests
npm run build    # typecheck + bundle
npm start        # production: one process, serves everything
```

## How the game works

Each round you get building cards, keep some, then get shop tiles. Then
everyone trades at once. Then you build. Then you get paid.

**Income depends only on the size of a business and whether it's finished** —
not on which business it is:

| tiles | 1 | 2 | 3 | 4 | 5 | 6 |
|---|---|---|---|---|---|---|
| unfinished | 10 | 20 | 40 | 60 | 80 | — |
| **finished** | — | — | **50** | **80** | **110** | **140** |

A finished 3-tile Tea House earns $50k. A stalled 3-tile Restaurant earns
$40k. A finished Restaurant earns $140k. That gap is the whole game — it's why
you'll beg someone for one specific building.

12 businesses, three at each size, `maxSize + 3` tiles each (90 total):

| size | businesses |
|---|---|
| 6 | Restaurant, Antiques, Factory |
| 5 | Dim Sum, Laundry, Take Out |
| 4 | Tropical Fish, Florist, Jewellery |
| 3 | Photo, Tea House, Sea Food |

Cards dealt per round as `draw/keep`, and shop tiles drawn:

| | 1 | 2 | 3 | 4 | 5 | 6 |
|---|---|---|---|---|---|---|
| 3p cards | 7/5 | 6/4 | 6/4 | 6/4 | 6/4 | 6/4 |
| 3p shops | 7 | 4 | 4 | 4 | 4 | 4 |
| 4p cards | 6/4 | 5/3 | 5/3 | 5/3 | 5/3 | 5/3 |
| 4p shops | 6 | 3 | 3 | 3 | 3 | 3 |
| 5p cards | 5/3 | 5/3 | 5/3 | 4/2 | 4/2 | 4/2 |
| 5p shops | 5 | 3 | 3 | 2 | 2 | 2 |

### Rules that are easy to get wrong

- **A run longer than the max splits.** Five adjacent Photo shops (max 3) are a
  finished 3 *plus* a separate 2 — $50k + $20k, not a capped $50k.
- **You can trade a building with a shop already on it.** The shop doesn't
  move, only the ownership marker. This is how you consolidate businesses.
- **Same shops, different owners = different businesses.** Buying your
  neighbour's single tile is what merges two small businesses into a big one.
- Once placed, a shop tile can never be moved or removed.
- Only **money** is secret. Tiles and buildings are public.

## Trading

Deals are a **shared table**, not offer-and-counteroffer:

- a deal is a list of transfers (`from → to`: a building, a tile, or cash)
- anyone can add or remove items, and any edit clears all confirmations
- when everyone involved has confirmed, it executes all at once
- 2-player and 5-player trades run the same code — a 3-way circular trade is
  just three items

Assets aren't locked while a deal is open, so several deals can happen at once
like they do at a table. If one goes stale it fails as a whole.

**Promises** ("I'll give you a restaurant tile next round") are written down
and shown to everyone but never enforced. That's on purpose.

## Staying connected

Refreshing the page doesn't kick you out. A seat belongs to a **token** in
`localStorage`, not to the socket:

- a dropped socket never frees a seat — it just shows "reconnecting…"
- the room is in the URL, so back/forward stay inside the app
- the client retries with backoff behind a banner
- rooms are saved to disk after every action, so a redeploy is survivable
- 25s heartbeat keeps proxies from killing idle sockets

## Layout

```
src/engine/      pure TypeScript game logic, no React
src/components/  board, deal panel
server/          websocket server, rooms, persistence
tools/           scripts to cut up photos of the real game
```

`reduce(state, action)` is the entire game. The server is "run the reducer,
send the result to everyone."

## Deploying to Railway

Railway detects Node, runs `npm run build`, then `npm start`.

1. **Replicas: 1** — rooms live in the process
2. **Attach a Volume**, set `DATA_DIR` to its path — the filesystem is
   ephemeral, so without this you lose games on every deploy
3. Health check: `/api/health`
4. Leave `PORT` alone

Voice isn't built in on purpose — play with Discord open. Text chat makes a
negotiation game feel dead.

## Notes

Rules and numbers come from the rulebook and photos of the components. The
board layout was transcribed from [sheki/chinatown](https://github.com/sheki/chinatown);
the vacant slots inside each district are the one thing not yet double-checked
against a real board.

The mechanics are fair game, but the name, board art and tile art belong to the
publisher. Reskin it before showing it to the public.
