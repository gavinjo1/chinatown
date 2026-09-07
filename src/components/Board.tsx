import { BOARD_HEIGHT, BOARD_WIDTH, LOTS } from '../engine/board';
import { BUSINESS_BY_ID } from '../engine/rules';
import type { LotId } from '../engine/types';
import type { GameView } from '../engine/view';

const CELL = 46;
const PAD = 4;

interface Props {
  state: GameView;
  /** Buildings the acting player can act on right now. */
  actionable?: Set<LotId>;
  /** Buildings currently picked (used by the keep/discard phase). */
  selected?: Set<LotId>;
  onLotClick?: (lot: LotId) => void;
}

export function Board({ state, actionable, selected, onLotClick }: Props) {
  const colorOf = (playerId: string) =>
    state.players.find((p) => p.id === playerId)?.color ?? '#555';

  return (
    <svg
      className="board"
      viewBox={`0 0 ${BOARD_WIDTH * CELL} ${BOARD_HEIGHT * CELL}`}
    >
      {LOTS.map((lot) => {
        const placement = state.placements[lot.id];
        const owner = state.ownership[lot.id];
        const isActionable = actionable?.has(lot.id) ?? false;
        const isSelected = selected?.has(lot.id) ?? false;

        const fill = placement
          ? BUSINESS_BY_ID[placement.type].color
          : isSelected
            ? '#3d4b63'
            : owner
              ? '#232a36'
              : '#171b23';

        const stroke = isSelected
          ? '#ffffff'
          : owner
            ? colorOf(owner)
            : isActionable
              ? '#5b6a80'
              : '#2b3240';

        const classes = ['lot'];
        if (isActionable) classes.push('actionable');
        if (isSelected) classes.push('selected');

        return (
          <g
            key={lot.id}
            className={classes.join(' ')}
            onClick={() => onLotClick?.(lot.id)}
          >
            <rect
              x={lot.x * CELL + PAD}
              y={lot.y * CELL + PAD}
              width={CELL - PAD * 2}
              height={CELL - PAD * 2}
              rx={4}
              fill={fill}
              stroke={stroke}
              strokeWidth={isSelected ? 3 : owner ? 2.5 : 1}
            />
            <text
              x={lot.x * CELL + CELL / 2}
              y={lot.y * CELL + CELL / 2 + (placement ? 6 : 4)}
              textAnchor="middle"
              fontSize={placement ? 18 : 11}
              fill={placement ? 'rgba(255,255,255,.95)' : '#8b95a5'}
            >
              {placement ? BUSINESS_BY_ID[placement.type].emoji : lot.id}
            </text>
            <title>
              {placement
                ? `${BUSINESS_BY_ID[placement.type].name} · building ${lot.id}`
                : `Building ${lot.id}`}
            </title>
          </g>
        );
      })}
    </svg>
  );
}
