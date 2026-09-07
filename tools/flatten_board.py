#!/usr/bin/env python3
"""Flatten a photographed board into a straight-on rectangle.

    python3 tools/flatten_board.py board.jpg public/board.png \\
        --corners 150,180 1290,95 1360,1880 95,1810 --size 2000x1400

This is a perspective correction (homography), not an AI redraw: the four
corners you give are mapped onto the corners of a clean rectangle and the
pixels are resampled. Nothing is invented, so numbers stay legible.

--corners takes the four corners of the board IN THE PHOTO, in the order
top-left, top-right, bottom-right, bottom-left *of the result you want*. That
is what handles rotation too — to turn a sideways photo upright, simply start
from the corner that should end up at the top left.

Pure Pillow; no numpy or OpenCV needed.
"""

from __future__ import annotations

import argparse
import pathlib
import sys

try:
    from PIL import Image
except ImportError:
    sys.exit("Pillow is required:  python3 -m pip install pillow")

Point = tuple[float, float]


def solve(matrix: list[list[float]], rhs: list[float]) -> list[float]:
    """Gaussian elimination with partial pivoting."""
    n = len(matrix)
    aug = [row[:] + [rhs[i]] for i, row in enumerate(matrix)]

    for col in range(n):
        pivot = max(range(col, n), key=lambda r: abs(aug[r][col]))
        if abs(aug[pivot][col]) < 1e-12:
            sys.exit("Degenerate corners — are all four points distinct?")
        aug[col], aug[pivot] = aug[pivot], aug[col]

        for row in range(n):
            if row == col:
                continue
            factor = aug[row][col] / aug[col][col]
            for k in range(col, n + 1):
                aug[row][k] -= factor * aug[col][k]

    return [aug[i][n] / aug[i][i] for i in range(n)]


def perspective_coeffs(dest: list[Point], src: list[Point]) -> list[float]:
    """Coefficients mapping OUTPUT coords back to INPUT coords, as PIL wants."""
    matrix: list[list[float]] = []
    rhs: list[float] = []
    for (x, y), (u, v) in zip(dest, src):
        matrix.append([x, y, 1, 0, 0, 0, -x * u, -y * u])
        rhs.append(u)
        matrix.append([0, 0, 0, x, y, 1, -x * v, -y * v])
        rhs.append(v)
    return solve(matrix, rhs)


def parse_point(text: str) -> Point:
    try:
        x, y = text.split(",")
        return float(x), float(y)
    except ValueError:
        raise argparse.ArgumentTypeError(f"expected x,y — got {text!r}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=pathlib.Path)
    parser.add_argument("output", type=pathlib.Path)
    parser.add_argument(
        "--corners",
        type=parse_point,
        nargs=4,
        required=True,
        metavar="X,Y",
        help="top-left, top-right, bottom-right, bottom-left (in the photo)",
    )
    parser.add_argument(
        "--size",
        default="",
        help="output size as WxH; defaults to the average edge lengths",
    )
    args = parser.parse_args()

    image = Image.open(args.source).convert("RGB")
    tl, tr, br, bl = args.corners

    def distance(a: Point, b: Point) -> float:
        return ((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2) ** 0.5

    if args.size:
        width, height = (int(n) for n in args.size.lower().split("x"))
    else:
        width = round((distance(tl, tr) + distance(bl, br)) / 2)
        height = round((distance(tl, bl) + distance(tr, br)) / 2)

    dest: list[Point] = [(0, 0), (width, 0), (width, height), (0, height)]
    coeffs = perspective_coeffs(dest, [tl, tr, br, bl])

    flattened = image.transform(
        (width, height), Image.PERSPECTIVE, coeffs, Image.BICUBIC
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    flattened.save(args.output)
    print(f"{args.output}  {width}x{height}")


if __name__ == "__main__":
    main()
