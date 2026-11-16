#!/usr/bin/env python3
"""Add icons to the app's Material Symbols subset (app/icons.mjs + app/fonts/material-symbols-rounded-subset.woff2).

Usage:
  python3 scripts/add-icons.py --source /path/to/material-symbols-rounded.woff2 layers=layers lock=lock fork=call_split

Each argument is  <name used in code>=<Material Symbols name>  (see https://fonts.google.com/icons).
The full font comes from the npm package "material-symbols" (material-symbols-rounded.woff2).
The subset keeps the FILL and wght axes and pins GRAD=0, opsz=24, like the original build.
"""
import argparse, re, sys
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.subset import Subsetter, Options
from fontTools.varLib.instancer import instantiateVariableFont

ROOT = Path(__file__).resolve().parents[1]
ICONS = ROOT / 'app/icons.mjs'
FONT = ROOT / 'app/fonts/material-symbols-rounded-subset.woff2'

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--source', required=True, help='full material-symbols-rounded.woff2')
    ap.add_argument('pairs', nargs='*', help='name=symbol')
    a = ap.parse_args()
    full = TTFont(a.source)
    inv = {}
    for cp, g in full.getBestCmap().items():
        inv.setdefault(g, cp)
    text = ICONS.read_text(encoding='utf-8')
    header = re.search(r'// Source symbol names: (.*)\n', text)
    names = dict(p.split('=', 1) for p in header.group(1).split(', ')) if header else {}
    codes = dict(re.findall(r'"([\w-]+)":0x([0-9A-Fa-f]+)', text))
    for pair in a.pairs:
        name, symbol = pair.split('=', 1)
        if symbol not in inv:
            sys.exit(f'Material Symbols has no icon named {symbol!r}')
        names[name] = symbol
        codes[name] = '%X' % inv[symbol]
    # every icon in the table must exist in the full font
    for name, hexcp in codes.items():
        if int(hexcp, 16) not in full.getBestCmap():
            sys.exit(f'codepoint for {name} ({hexcp}) is not in the source font')
    body = ',\n'.join(f' "{n}":0x{c.upper()}' for n, c in codes.items())
    text = re.sub(r'// Source symbol names: .*\n', '// Source symbol names: ' + ', '.join(f'{n}={s}' for n, s in names.items()) + '\n', text)
    text = re.sub(r'const codes=\{\n.*?\n\};', 'const codes={\n' + body + '\n};', text, flags=re.S)
    ICONS.write_text(text, encoding='utf-8')
    font = TTFont(a.source)
    opts = Options()
    opts.layout_features = ['*']
    opts.flavor = 'woff2'
    sub = Subsetter(opts)
    sub.populate(unicodes=[int(c, 16) for c in codes.values()])
    sub.subset(font)
    font = instantiateVariableFont(font, {'GRAD': 0, 'opsz': 24})
    font.flavor = 'woff2'
    font.save(FONT)
    print(f'{len(codes)} icons, {FONT.stat().st_size} bytes')

if __name__ == '__main__':
    main()
