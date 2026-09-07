import type { GameState, Player, PlayerId } from './types';

/** A player as seen by someone else: everything except their money. */
export interface PlayerView extends Omit<Player, 'money'> {
  /** Absent for every player but the viewer — money is secret. */
  money?: number;
}

/** The game as seen by one player. This is the shape that goes on the wire. */
export interface GameView extends Omit<GameState, 'players'> {
  players: PlayerView[];
}

/** Build the view a single player is allowed to receive.
 *
 *  Money is the only secret in Chinatown — shop tiles are revealed the moment
 *  they leave the bag and kept buildings are revealed too — so redaction is a
 *  single field. The balance is *removed from the payload*, not hidden in the
 *  UI: anything that reaches the browser can be read out of devtools.
 *
 *  Pass `null` for a viewer who legitimately holds every seat (hotseat). */
export function viewFor(state: GameState, viewer: PlayerId | null): GameView {
  if (viewer === null) return state;
  // Holdings are secret *during* the game. Once it is over everyone counts
  // up, so the final balances are revealed — otherwise nobody could see who
  // actually won.
  if (state.phase === 'gameover') return state;

  return {
    ...state,
    players: state.players.map((player) => {
      if (player.id === viewer) return player;
      const { money: _money, ...rest } = player;
      return rest;
    }),
  };
}

/** True when no balance other than the viewer's survives. Used by tests to
 *  assert the wire payload really is redacted. */
export function leaksMoney(view: GameView, viewer: PlayerId): boolean {
  return view.players.some((p) => p.id !== viewer && p.money !== undefined);
}
