#!/usr/bin/env python3
"""Rasterize glyphs from a TTF into GLSL bitmap rows for .frag shaders.

Usage: python3 scripts/font-to-glsl.py <font.ttf> <text> [pointsize]

For each distinct character in <text>, renders it with ImageMagick at a
naive small point size, thresholds at 50% coverage, trims to the glyph
bounding box, and prints GLSL const declarations (per-glyph width and
top-down row bitmasks) ready to paste into a fragment shader.

NOTE: rows are emitted top-down (row 0 = top of glyph). In the shader,
index with a FLIPPED y because gl_FragCoord.y grows bottom-up — see
resources/shaders/SHADER-NOTES.md.
"""
import subprocess
import sys
from shutil import which

def rasterize(font: str, ch: str, pointsize: int):
    out = subprocess.run(
        ["magick", "-font", font, "-pointsize", str(pointsize),
         "-background", "black", "-fill", "white", f"label:{ch}", "txt:-"],
        capture_output=True, text=True, check=True).stdout
    grid = []
    for line in out.splitlines()[1:]:
        pos, rest = line.split(":", 1)
        x, y = map(int, pos.split(","))
        hexpix = rest.split("#")[1].split()[0]
        # first hex byte = red channel; treat >=50% as "on"
        on = int(hexpix[:2], 16) >= 128
        while len(grid) <= y:
            grid.append([])
        grid[y].append(on)
    # trim to bounding box
    rows = [r for r in grid if any(r)]
    if not rows:
        return []
    cols = any(row[c] for row in rows for c in range(len(row)))  # sanity
    xs = [c for c in range(len(grid[0])) if any(row[c] for row in rows)]
    x0, x1 = min(xs), max(xs)
    return [[1 if row[c] else 0 for c in range(x0, x1 + 1)] for row in rows]

def row_bits(row) -> int:
    v = 0
    for bit in row:            # leftmost pixel = bit 0 (MSB-side convention chosen in shader)
        v = (v << 1) | bit
    return v

def main():
    if which("magick") is None:
        sys.exit("ImageMagick 'magick' not found")
    font, text = sys.argv[1], sys.argv[2]
    pointsize = int(sys.argv[3]) if len(sys.argv) > 3 else 10
    for ch in sorted(set(text)):
        if ch == " ":
            continue
        rows = rasterize(font, ch, pointsize)
        w = max((len(r) for r in rows), default=0)
        print(f"  // '{ch}'  {w}x{len(rows)}")
        vals = ", ".join(str(row_bits(r)).zfill(2) for r in rows)
        print(f"  int[{len(rows)}]({vals}),")

if __name__ == "__main__":
    main()
