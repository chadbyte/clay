"""Render alpha-aware shipped sheets and enlarged source/master comparisons."""
from pathlib import Path
from PIL import Image, ImageDraw
import json

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'output/imagegen/clay-mates'
DESTINATION = SOURCE / 'verification/transparency-v9'
PROBLEMS = ['C41', 'C22', 'C25', 'B05', 'B21', 'B30', 'B35', 'B40', 'B07', 'C46', 'C07', 'lead-clay']
THEMES = [('light', '#f4f0e8'), ('dark', '#202328')]


def composite(image, background):
    tile = Image.new('RGBA', image.size, background)
    tile.alpha_composite(image.convert('RGBA'))
    return tile.convert('RGB')


def main():
    manifest = json.loads((SOURCE / 'manifest.json').read_text())
    items = manifest['entries'] + [manifest['lead']]
    DESTINATION.mkdir(parents=True, exist_ok=True)
    for family in ['B', 'C']:
        for first in [1, 25]:
            selected = [item for item in items if item['id'] in [f'{family}{n:02}' for n in range(first, first + 24)]]
            for theme, background in [('source', '#dedede')] + THEMES:
                sheet = Image.new('RGB', (1440, 1060), background)
                draw = ImageDraw.Draw(sheet)
                for index, item in enumerate(selected):
                    image = Image.open(ROOT / item['master' if theme == 'source' else 'shipped'])
                    image = image.resize((240, 240), Image.Resampling.LANCZOS)
                    x, y = (index % 6) * 240, (index // 6) * 265
                    sheet.paste(image.convert('RGB') if theme == 'source' else composite(image, background), (x, y + 25))
                    draw.text((x + 5, y + 5), item['id'], fill='white' if theme == 'dark' else 'black')
                sheet.save(DESTINATION / f'{family}{first:02}-{first + 23:02}-{theme}.png')
    for item in items:
        if item['id'] not in PROBLEMS:
            continue
        original = Image.open(ROOT / item['master']).convert('RGB')
        result = Image.open(ROOT / item['transparentMaster']).convert('RGBA')
        shipped = Image.open(ROOT / item['shipped']).convert('RGBA')
        sheet = Image.new('RGB', (1536, 780), '#dedede')
        draw = ImageDraw.Draw(sheet)
        sheet.paste(original.resize((512, 512)), (0, 30))
        draw.text((10, 10), item['id'] + ' untouched source', fill='black')
        for column, (theme, background) in enumerate(THEMES, 1):
            tile = composite(result, background).resize((512, 512))
            sheet.paste(tile, (column * 512, 30))
            draw.text((column * 512 + 10, 10), 'full-resolution result on ' + theme, fill='black')
            compact = composite(shipped, background)
            sheet.paste(compact, (column * 512 + 160, 575))
            draw.text((column * 512 + 10, 550), 'shipped 192x192 on ' + theme, fill='black')
        sheet.save(DESTINATION / (item['id'] + '-comparison.png'))
    print('Rendered all 97 in catalog contact sheets; 96 in grouped source/light/dark sheets; 12 enlarged comparisons including lead.')


if __name__ == '__main__':
    main()
