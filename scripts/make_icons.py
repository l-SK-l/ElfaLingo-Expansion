#!/usr/bin/env python3
"""Builds the extension's icons from the web app's own ones.

Sources (assets/brand/, copied from the ElfaLingo repository):
  badge-512.png    web/icons/Icon-512.png — the head on the rounded badge
  favicon-32.png   web/favicon.png        — the simplified head the site shows in a tab
  favicon-16.png   web/icons/favicon-16.png

The toolbar gets the favicons as they are: they were drawn for 16 and 32 px,
and the toolbar button is the same size as a tab's icon, so the extension
looks exactly like the site it talks to. The badge is for the larger sizes.

The 128 px icon keeps 16 px of transparent padding around a 96 px badge, as
the Chrome Web Store asks: the store and the install dialog put it on both
light and dark backgrounds, and the full-bleed square would look cut off.

The `-off` variants are what the toolbar shows while the server cannot be
reached: a grey cat next to the red badge reads as "not working" even to
someone who never hovers for the tooltip.

Run with `npm run icons`; needs Pillow.
"""

from pathlib import Path

from PIL import Image, ImageEnhance

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'assets/brand'
OUT = ROOT / 'extension/icons'


def fit(img, size):
    return img.resize((size, size), Image.Resampling.LANCZOS)


def padded(img, size, inner):
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    offset = (size - inner) // 2
    canvas.paste(fit(img, inner), (offset, offset))
    return canvas


def greyed(img):
    alpha = img.getchannel('A')
    grey = ImageEnhance.Brightness(img.convert('L')).enhance(1.15).convert('RGBA')
    # Paler as well as grey: the icon should step back, not just lose colour.
    grey.putalpha(alpha.point(lambda a: a * 3 // 5))
    return grey


def save(img, name):
    OUT.mkdir(parents=True, exist_ok=True)
    img.save(OUT / name, optimize=True)


def main():
    badge = Image.open(SRC / 'badge-512.png').convert('RGBA')
    toolbar = {
        16: Image.open(SRC / 'favicon-16.png').convert('RGBA'),
        32: Image.open(SRC / 'favicon-32.png').convert('RGBA'),
    }

    for size, img in toolbar.items():
        save(img, f'icon-{size}.png')
        save(greyed(img), f'icon-{size}-off.png')

    save(fit(badge, 48), 'icon-48.png')
    save(padded(badge, 128, 96), 'icon-128.png')


if __name__ == '__main__':
    main()
