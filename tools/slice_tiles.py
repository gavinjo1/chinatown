#!/usr/bin/env python3
"""Cut the 3x4 sheet of business tiles into 12 named PNGs.

    python3 tools/slice_tiles.py sheet.png public/tiles

The sheet is laid out three across, four down, in size order:

    Photo(3)      Tea House(3)      Sea Food(3)
    Jewellery(4)  Tropical Fish(4)  Florist(4)
    Take Out(5)   Laundry(5)        Dim Sum(5)
    Antiques(6)   Factory(6)        Restaurant(6)

Output filenames match the business ids in src/engine/rules.ts, so the UI can
reference them as `/tiles/<id>.png`.
"""

from __future__ import annotations

import argparse
import pathlib
import sys

try:
    from PIL import Image
except ImportError:
    sys.exit("Pillow is required:  python3 -m pip install pillow")

# Row-major, matching the sheet.
GRID = [
    ["photo", "teahouse", "seafood"],
    ["jewellery", "tropicalfish", "florist"],
    ["takeout", "laundry", "dimsum"],
    ["antiques", "factory", "restaurant"],
]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=pathlib.Path)
    parser.add_argument("outdir", type=pathlib.Path)
    parser.add_argument(
        "--inset",
        type=int,
        default=0,
        help="pixels to trim from each edge of every tile, to drop borders",
    )
    parser.add_argument(
        "--size",
        type=int,
        default=0,
        help="if set, resize each tile to this many pixels square",
    )
    args = parser.parse_args()

    image = Image.open(args.source).convert("RGBA")
    rows, cols = len(GRID), len(GRID[0])
    cell_w = image.width / cols
    cell_h = image.height / rows

    args.outdir.mkdir(parents=True, exist_ok=True)

    for r, row in enumerate(GRID):
        for c, name in enumerate(row):
            box = (
                round(c * cell_w) + args.inset,
                round(r * cell_h) + args.inset,
                round((c + 1) * cell_w) - args.inset,
                round((r + 1) * cell_h) - args.inset,
            )
            tile = image.crop(box)
            if args.size:
                tile = tile.resize((args.size, args.size), Image.LANCZOS)
            path = args.outdir / f"{name}.png"
            tile.save(path)
            print(f"{path}  {tile.width}x{tile.height}")

    print(f"\n{rows * cols} tiles written to {args.outdir}")


if __name__ == "__main__":
    main()
