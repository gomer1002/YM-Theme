#!/usr/bin/env python3
"""Вытаскивает CSS-правила, в селекторе которых встречается подстрока.

    python tools/css_extract.py VibePage_ VibePlayerBar_ AlbumCover_ > out.css
"""
import glob
import os
import re
import sys

CSS_DIR = os.path.join("reference", "asar", "app", "_next", "static", "css")


def main():
    needles = sys.argv[1:]
    if not needles:
        print(__doc__)
        return 1
    for path in sorted(glob.glob(os.path.join(CSS_DIR, "*.css"))):
        with open(path, "r", encoding="utf-8") as f:
            css = f.read()
        # грубо, но достаточно: правила верхнего уровня и внутри @media
        for match in re.finditer(r"([^{}]+)\{([^{}]*)\}", css):
            selector, body = match.group(1).strip(), match.group(2).strip()
            if any(n in selector for n in needles):
                print(f"/* {os.path.basename(path)} */")
                print(f"{selector} {{ {body} }}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
