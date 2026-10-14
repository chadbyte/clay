"""Reproduce the catalog from preserved AI sheets; never overwrite a source."""
from pathlib import Path
from PIL import Image, ImageOps
import hashlib
import json
import re
import shutil

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'output/imagegen/clay-mates'
SHIPPED = ROOT / 'lib/public/mate-avatars'
MASTERS = SOURCE / 'masters'
SHIPPED.mkdir(parents=True, exist_ok=True)
MASTERS.mkdir(parents=True, exist_ok=True)
# Pixel bands were visually inspected to exclude labels and neighboring heads.
SHEETS = [
    ('B', 1, 'concepts-01-12.png', [(0, 317), (350, 645), (677, 985)]),
    ('B', 13, 'concepts-13-24.png', [(0, 318), (352, 642), (677, 986)]),
    ('B', 25, 'concepts-25-36.png', [(0, 320), (352, 646), (681, 1001)]),
    ('B', 37, 'concepts-37-48.png', [(0, 302), (346, 635), (671, 983)]),
    ('C', 1, 'c-expressive-concepts-01-12.png', [(0, 347), (382, 684), (720, 1023)]),
    ('C', 13, 'c-expressive-concepts-13-24.png', [(0, 353), (359, 694), (697, 1086)]),
    ('C', 25, 'c-expressive-concepts-25-36.png', [(0, 380), (384, 700), (702, 1086)]),
    ('C', 37, 'c-expressive-concepts-37-48.png', [(0, 376), (382, 706), (710, 1086)]),
]

def digest(file):
    return hashlib.sha256(file.read_bytes()).hexdigest()

provenance = json.loads((SOURCE / 'generation.json').read_text())
originals = {Path(e['source']).name: e['generatedOriginal'] for e in provenance['sheets']}
entries = []
for family, first, filename, bands in SHEETS:
    source = SOURCE / filename
    image = Image.open(source).convert('RGB')
    width, height = image.size
    assert (width, height) == (1448, 1086), (filename, image.size)
    for row, (top, bottom) in enumerate(bands):
        for column in range(4):
            id = f'{family}{first + row * 4 + column:02d}'
            left, right = column * 362, (column + 1) * 362
            if id == 'B17': right = 391
            if id == 'B18': left = 391
            if id == 'B37': right = 382
            if id == 'B38': left = 382
            crop_top = 667 if id == 'B21' else top
            if family == 'C' and first == 25:
                left, right = [(0, 375), (375, 717), (717, 1066), (1066, 1448)][column]
            box = (left, crop_top, right, bottom)
            crop = image.crop(box)
            # Retain every cropped source pixel in a square, no upscaling masters.
            side = max(crop.size)
            master = Image.new('RGB', (side, side), crop.getpixel((0, 0)))
            master.paste(crop, ((side - crop.width) // 2, (side - crop.height) // 2))
            master_path = MASTERS / (id + '.png')
            master.save(master_path, optimize=True)
            compact = master.resize((192, 192), Image.Resampling.LANCZOS)
            compact = compact.quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
            shipped_path = SHIPPED / (id + '.png')
            compact.save(shipped_path, optimize=True)
            entries.append({'id': id, 'family': family, 'source': str(source.relative_to(ROOT)),
                            'sourceSha256': digest(source), 'generatedOriginal': originals[filename], 'crop': box,
                            'master': str(master_path.relative_to(ROOT)), 'masterSize': master.size,
                            'masterSha256': digest(master_path),
                            'shipped': str(shipped_path.relative_to(ROOT)), 'size': [192, 192],
                            'bytes': shipped_path.stat().st_size, 'sha256': digest(shipped_path)})
manifest = {'version': 1, 'generation': 'OpenAI built-in image_gen; preserved full-resolution sheets',
            'processing': 'Explicit inspected crop bands; square RGB padding without resizing masters; Lanczos 192x192; 256-color PNG, no dithering, optimized lossless PNG encoding',
            'count': len(entries), 'families': {'B': 48, 'C': 48},
            'totalPngBytes': sum(e['bytes'] for e in entries), 'entries': entries}
(SOURCE / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
metadata_source = (ROOT / 'lib/public/modules/mate-avatar-catalog.js').read_text()
collections = json.loads(re.search(r'export var MATE_AVATAR_COLLECTIONS = (.*?);', metadata_source, re.S).group(1))
names = {avatar['id']: avatar['name'] for collection in collections for avatar in collection['avatars']}
(SHIPPED / 'catalog.json').write_text(json.dumps([{'id': e['id'], 'family': e['family'], 'name': names[e['id']]} for e in entries], indent=2) + '\n')
# Inspection contact sheets from shipped images, for detecting crop/label bleed.
for family in ['B', 'C']:
    sheet = Image.new('RGB', (8 * 192, 6 * 192), '#f2eee5')
    for n in range(48):
        sheet.paste(Image.open(SHIPPED / f'{family}{n+1:02d}.png').convert('RGB'), ((n % 8) * 192, (n // 8) * 192))
    sheet.save(SOURCE / f'{family}-shipped-review.png')
print(json.dumps({k: manifest[k] for k in ['count', 'families', 'totalPngBytes']}))
# Canonical Clay is a separate portrait, excluded from the B/C gallery count.
lead_source = SOURCE / 'lead-clay-logo-sculpt-v2.png'
lead = Image.open(lead_source).convert('RGB')
lead_master = MASTERS / 'lead-clay.png'
lead_previous_master = MASTERS / 'lead-clay-indigo-v1-master.png'
if lead_master.exists() and not lead_previous_master.exists():
    shutil.copyfile(lead_master, lead_previous_master)
lead.save(lead_master, optimize=True)
lead_compact = lead.resize((192, 192), Image.Resampling.LANCZOS).quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
lead_shipped = SHIPPED / 'lead-clay.png'
lead_compact.save(lead_shipped, optimize=True)
manifest['lead'] = {'id': 'lead-clay', 'source': str(lead_source.relative_to(ROOT)), 'sourceSize': lead.size, 'sourceBytes': lead_source.stat().st_size, 'sourceSha256': digest(lead_source), 'master': str(lead_master.relative_to(ROOT)), 'masterSize': lead.size, 'masterBytes': lead_master.stat().st_size, 'masterSha256': digest(lead_master), 'previousMaster': str(lead_previous_master.relative_to(ROOT)) if lead_previous_master.exists() else None, 'previousMasterBytes': lead_previous_master.stat().st_size if lead_previous_master.exists() else None, 'previousMasterSha256': digest(lead_previous_master) if lead_previous_master.exists() else None, 'shipped': str(lead_shipped.relative_to(ROOT)), 'size': [192, 192], 'bytes': lead_shipped.stat().st_size, 'sha256': digest(lead_shipped)}
manifest['totalPngBytesIncludingLead'] = manifest['totalPngBytes'] + lead_shipped.stat().st_size
(SOURCE / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
print(json.dumps({'leadBytes': manifest['lead']['bytes'], 'totalPngBytesIncludingLead': manifest['totalPngBytesIncludingLead']}))
