#!/usr/bin/env python3
"""Regenerate the web crop of the cuconv feature-map figure.

Takes the full matplotlib figure from a cuconv results directory and produces the
version the site uses: title block and stats footer cropped off, resized, saved as a
progressive JPEG. Run it again after any new benchmark run so the site figure never
goes stale.

    python3 tools/make_figure.py ../cuconv/results/t4-20261102-2346 img/cuconv-featuremaps.jpg
"""
import sys
from pathlib import Path
from PIL import Image

MAX_WIDTH = 1200
QUALITY = 84
WARN_KB = 200
FAIL_KB = 400

# Fractions of the full figure height. The matplotlib figure puts a title and subtitle
# above the panels and two lines of error stats below them; the site supplies its own
# caption, so both are cropped. Fractions rather than pixels so a regenerated figure at
# a different DPI still crops correctly.
TOP, BOTTOM = 0.140, 0.871
LEFT, RIGHT = 0.008, 0.996


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__)
        return 2
    results_dir, out_path = Path(sys.argv[1]), Path(sys.argv[2])
    src = results_dir / "featuremaps.png"
    if not src.exists():
        print(f"error: {src} not found")
        return 1

    im = Image.open(src).convert("RGB")
    w, h = im.size
    im = im.crop((int(LEFT * w), int(TOP * h), int(RIGHT * w), int(BOTTOM * h)))
    im.thumbnail((MAX_WIDTH, MAX_WIDTH), Image.LANCZOS)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    im.save(out_path, quality=QUALITY, optimize=True, progressive=True)

    kb = out_path.stat().st_size / 1024
    print(f"{out_path}  {im.size[0]}x{im.size[1]}  {kb:.0f} KB")
    if kb > FAIL_KB:
        print(f"error: over {FAIL_KB} KB, lower QUALITY or MAX_WIDTH")
        return 1
    if kb > WARN_KB:
        print(f"warning: over {WARN_KB} KB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
