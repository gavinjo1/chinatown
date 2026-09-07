import type { Lot, LotId } from './types';

/* ========================================================================
 * The board: 85 lots across 6 irregular city zones.
 *
 * Layout transcribed from github.com/sheki/chinatown (src/ZoneOne.re …
 * ZoneSix.re). Each zone is a small grid where 0 means "no lot here" — the
 * blanks are what give the blocks their real, non-rectangular shapes.
 *
 * Adjacency: orthogonally touching AND in the same zone. A street between
 * zones always breaks a business.
 * ===================================================================== */

interface Zone {
  /** Top-left position of the zone on the world grid. */
  x: number;
  y: number;
  /** Row-major lot ids; 0 is a gap. */
  rows: number[][];
}

const ZONES: Zone[] = [
  {
    x: 0,
    y: 0,
    rows: [
      [0, 1, 2, 0],
      [0, 3, 4, 5],
      [6, 7, 8, 9],
      [10, 11, 12, 0],
      [13, 14, 15, 0],
    ],
  },
  {
    x: 5,
    y: 0,
    rows: [
      [16, 17, 18],
      [19, 20, 21],
      [22, 23, 0],
      [24, 25, 0],
      [26, 27, 0],
    ],
  },
  {
    x: 9,
    y: 0,
    rows: [
      [28, 29, 30, 0],
      [31, 32, 33, 0],
      [34, 35, 36, 0],
      [0, 37, 38, 39],
      [0, 40, 41, 42],
    ],
  },
  {
    x: 0,
    y: 6,
    rows: [
      [43, 44, 45, 46],
      [47, 48, 49, 50],
      [51, 52, 53, 54],
      [0, 0, 55, 56],
      [0, 0, 57, 58],
    ],
  },
  {
    x: 5,
    y: 6,
    rows: [
      [59, 60, 0],
      [61, 62, 0],
      [63, 64, 65],
      [66, 67, 68],
      [0, 69, 70],
    ],
  },
  {
    x: 9,
    y: 6,
    rows: [
      [71, 72, 73, 74],
      [75, 76, 77, 78],
      [79, 80, 81, 82],
      [83, 84, 85, 0],
    ],
  },
];

function buildLots(): Lot[] {
  const lots: Lot[] = [];
  ZONES.forEach((zone, zoneIndex) => {
    zone.rows.forEach((row, dy) => {
      row.forEach((id, dx) => {
        if (id === 0) return;
        lots.push({ id, block: zoneIndex, x: zone.x + dx, y: zone.y + dy });
      });
    });
  });
  return lots.sort((a, b) => a.id - b.id);
}

export const LOTS: Lot[] = buildLots();

export const LOT_BY_ID: Record<LotId, Lot> = Object.fromEntries(
  LOTS.map((l) => [l.id, l]),
);

export const BOARD_WIDTH = Math.max(...LOTS.map((l) => l.x)) + 1;
export const BOARD_HEIGHT = Math.max(...LOTS.map((l) => l.y)) + 1;

function buildNeighbours(): Record<LotId, LotId[]> {
  const byCoord = new Map<string, Lot>();
  for (const lot of LOTS) byCoord.set(`${lot.x},${lot.y}`, lot);

  const result: Record<LotId, LotId[]> = {};
  for (const lot of LOTS) {
    const candidates = [
      byCoord.get(`${lot.x + 1},${lot.y}`),
      byCoord.get(`${lot.x - 1},${lot.y}`),
      byCoord.get(`${lot.x},${lot.y + 1}`),
      byCoord.get(`${lot.x},${lot.y - 1}`),
    ];
    result[lot.id] = candidates
      .filter((n): n is Lot => !!n && n.block === lot.block)
      .map((n) => n.id);
  }
  return result;
}

/** lot id -> ids of lots that can form one business with it. */
export const NEIGHBOURS: Record<LotId, LotId[]> = buildNeighbours();
