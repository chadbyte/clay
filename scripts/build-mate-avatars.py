"""Package original RGB art with reviewed, saved local foreground masks."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageChops, __version__ as pillow_version
import hashlib
import json
import re

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'output/imagegen/clay-mates'
SHIPPED = ROOT / 'lib/public/mate-avatars'
MASTERS = SOURCE / 'masters'
TRANSPARENT_MASTERS = SOURCE / 'transparent-masters'
TRANSPARENT_PROGRESS = SOURCE / 'transparent-progress.json'
TRANSPARENT_PROCESSING_VERSION = 9
LEAD_ASSET_VERSION = 4


def digest(file):
    return hashlib.sha256(file.read_bytes()).hexdigest()


def write_json(path, value):
    content = json.dumps(value, indent=2) + '\n'
    if path.exists() and path.read_text() == content:
        return
    temporary = path.with_name('.' + path.name + '.tmp')
    temporary.write_text(content)
    temporary.replace(path)


def save_png(image, path):
    temporary = path.with_name('.' + path.name + '.tmp')
    image.save(temporary, format='PNG', optimize=True)
    if path.exists() and digest(path) == digest(temporary):
        temporary.unlink()
    else:
        temporary.replace(path)


def verify_originals():
    record = json.loads((SOURCE / 'source-preservation.json').read_text())
    for filename, expected in record['files'].items():
        assert digest(ROOT / filename) == expected, 'Original changed: ' + filename
    return record


def ensure_transparent_master(source, ident, masks, progress):
    output = TRANSPARENT_MASTERS / (ident + '.png')
    entry = masks['entries'][ident]
    mask_path = ROOT / entry['mask']
    boundary_path = ROOT / entry['boundary']
    source_hash = digest(source)
    assert entry['sourceSha256'] == source_hash, 'Stale mask: ' + ident
    assert entry['sha256'] == digest(mask_path), 'Changed mask: ' + ident
    assert entry['boundarySha256'] == digest(boundary_path), 'Changed boundary: ' + ident
    previous = progress.get(ident, {})
    if (output.exists() and previous.get('sourceSha256') == source_hash
            and previous.get('maskSha256') == entry['sha256']
            and previous.get('boundarySha256') == entry['boundarySha256']
            and previous.get('processingVersion') == TRANSPARENT_PROCESSING_VERSION
            and previous.get('outputSha256') == digest(output)):
        return Image.open(output).convert('RGBA'), previous
    rgb = Image.open(source).convert('RGB')
    mask = Image.open(mask_path)
    assert mask.mode == 'L' and mask.size == rgb.size, 'Invalid mask: ' + ident
    boundary = Image.open(boundary_path).convert('RGBA')
    assert boundary.size == rgb.size
    corrections = boundary.getchannel('A')
    # Every correction must stay inside the fractional-alpha boundary band.
    fractional = mask.point([255 if 0 < value < 255 else 0 for value in range(256)])
    assert ImageChops.subtract(corrections, fractional).getbbox() is None
    corrected = rgb.copy()
    corrected.paste(boundary.convert('RGB'), (0, 0), corrections)
    rgba = corrected.convert('RGBA')
    rgba.putalpha(mask)
    save_png(rgba, output)
    histogram = mask.histogram()
    result = {'id': ident, 'processingVersion': TRANSPARENT_PROCESSING_VERSION,
              'source': str(source.relative_to(ROOT)), 'sourceSha256': source_hash,
              'mask': entry['mask'], 'maskSha256': entry['sha256'],
              'boundary': entry['boundary'], 'boundarySha256': entry['boundarySha256'],
              'boundaryPixels': entry['boundaryPixels'],
              'output': str(output.relative_to(ROOT)), 'outputSize': list(rgba.size),
              'outputBytes': output.stat().st_size, 'outputSha256': digest(output),
              'alpha': {'opaquePixels': histogram[255], 'transparentPixels': histogram[0],
                        'partialPixels': sum(histogram[1:255]), 'alphaMin': mask.getextrema()[0],
                        'alphaMax': mask.getextrema()[1]}}
    progress[ident] = result
    write_json(TRANSPARENT_PROGRESS, {'version': TRANSPARENT_PROCESSING_VERSION,
                                               'processing': 'Saved foreground mask applied to original RGB; fractional-edge RGB decontamination only; resume verifies source, mask, boundary and output SHA256.',
                                               'entries': dict(sorted(progress.items()))})
    return rgba, result


def package(item, masks, progress):
    ident = item['id']
    assert digest(ROOT / item['source']) == item['sourceSha256'], 'Original source changed: ' + ident
    master_path = ROOT / item['master']
    assert digest(master_path) == item['masterSha256'], 'Original master changed: ' + ident
    transparent, entry = ensure_transparent_master(master_path, ident, masks, progress)
    shipped_path = SHIPPED / (ident + '.png')
    # Pillow resamples RGBA through premultiplied alpha, avoiding opaque padding bleed.
    save_png(transparent.resize((192, 192), Image.Resampling.LANCZOS), shipped_path)
    item.update({'transparentMaster': entry['output'], 'transparentMasterSize': entry['outputSize'],
                 'transparentMasterBytes': entry['outputBytes'], 'transparentMasterSha256': entry['outputSha256'],
                 'foregroundMask': entry['mask'], 'foregroundMaskSha256': entry['maskSha256'],
                 'boundaryColors': entry['boundary'], 'boundaryColorsSha256': entry['boundarySha256'],
                 'boundaryPixels': entry['boundaryPixels'],
                 'shipped': str(shipped_path.relative_to(ROOT)), 'size': [192, 192],
                 'bytes': shipped_path.stat().st_size, 'sha256': digest(shipped_path)})


def reviews(items):
    for theme, background in [('light', '#f4f0e8'), ('dark', '#202328')]:
        sheet = Image.new('RGB', (12 * 192, 9 * 214), background)
        draw = ImageDraw.Draw(sheet)
        for index, item in enumerate(items):
            image = Image.open(ROOT / item['shipped']).convert('RGBA')
            tile = Image.new('RGBA', image.size, background)
            tile.alpha_composite(image)
            x, y = (index % 12) * 192, (index // 12) * 214
            sheet.paste(tile.convert('RGB'), (x, y + 22))
            draw.text((x + 5, y + 5), item['id'], fill='white' if theme == 'dark' else 'black')
        sheet.save(SOURCE / ('alpha-review-' + theme + '.png'))
        for family in ['B', 'C']:
            portraits = [item for item in items if item.get('family') == family]
            family_sheet = Image.new('RGB', (8 * 192, 6 * 214), background)
            for index, item in enumerate(portraits):
                x, y = (index % 8) * 192, (index // 8) * 214
                source_index = items.index(item)
                sx, sy = (source_index % 12) * 192, (source_index // 12) * 214
                family_sheet.paste(sheet.crop((sx, sy, sx + 192, sy + 214)), (x, y))
            family_sheet.save(SOURCE / (family + '-shipped-review-' + theme + '.png'))
            if theme == 'light':
                family_sheet.save(SOURCE / (family + '-shipped-review.png'))


def main():
    originals = verify_originals()
    manifest = json.loads((SOURCE / 'catalog-source-map.json').read_text())
    masks = json.loads((SOURCE / 'foreground-masks/manifest.json').read_text())
    items = manifest['entries'] + [manifest['lead']]
    expected_ids = [f'{family}{n:02}' for family in ['B', 'C'] for n in range(1, 49)] + ['lead-clay']
    assert [item['id'] for item in items] == expected_ids
    assert set(masks['entries']) == set(expected_ids), 'Incomplete foreground masks'
    SHIPPED.mkdir(exist_ok=True)
    TRANSPARENT_MASTERS.mkdir(exist_ok=True)
    try:
        progress = json.loads(TRANSPARENT_PROGRESS.read_text()).get('entries', {})
    except (OSError, ValueError):
        progress = {}
    for item in items:
        package(item, masks, progress)
    manifest.update({'assetVersion': LEAD_ASSET_VERSION,
                     'generation': 'Preserved original art; deterministic local foreground segmentation; no image generation',
                     'processing': 'Reviewed saved BiRefNet-General masks; original RGB at alpha 0/255 and closed-form matting foreground RGB only in fractional-alpha boundary band; full-resolution RGBA masters; premultiplied-alpha Lanczos 192x192 RGBA PNG; optimized lossless encoding',
                     'segmentationModel': masks['model'], 'matting': masks['processing'],
                     'buildPillowVersion': pillow_version, 'sourceBaselineCommit': originals['baselineCommit'],
                     'sourceMapSha256': digest(SOURCE / 'catalog-source-map.json'),
                     'count': 96, 'countIncludingLead': 97, 'families': {'B': 48, 'C': 48},
                     'totalPngBytes': sum(item['bytes'] for item in manifest['entries']),
                     'totalPngBytesIncludingLead': sum(item['bytes'] for item in items),
                     'totalTransparentMasterBytes': sum(item['transparentMasterBytes'] for item in items)})
    write_json(SOURCE / 'manifest.json', manifest)
    metadata_source = (ROOT / 'lib/public/modules/mate-avatar-catalog.js').read_text()
    collections = json.loads(re.search(r'export var MATE_AVATAR_COLLECTIONS = (.*?);', metadata_source, re.S).group(1))
    names = {avatar['id']: avatar['name'] for collection in collections for avatar in collection['avatars']}
    write_json(SHIPPED / 'catalog.json', [{'id': item['id'], 'family': item['family'], 'name': names[item['id']]} for item in manifest['entries']])
    # Lead is rebuilt before every contact sheet, so review always includes fresh art.
    reviews(items)
    verify_originals()
    print(json.dumps({key: manifest[key] for key in ['countIncludingLead', 'totalPngBytesIncludingLead', 'totalTransparentMasterBytes']}))


if __name__ == '__main__':
    main()
