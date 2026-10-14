"""Pixel regressions chosen from original art, independently of mask coverage."""
from pathlib import Path
from PIL import Image, ImageChops
import hashlib
import importlib.util
import json
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'output/imagegen/clay-mates'
# Coordinates were selected on the untouched originals, before the new batch.
# Each is the center of a 7x7 patch, expressed as a fraction of master size.
FOREGROUND = {
    'C41': [('ivory crown', .50, .32), ('ivory cheek', .28, .73), ('ivory chin', .50, .80),
            ('left ear', .10, .56), ('right ear', .88, .56), ('antenna ball', .52, .14)],
    'C22': [('ivory crown', .42, .32), ('ivory chin', .50, .76),
            ('left ear', .08, .54), ('right ear', .89, .54), ('ivory antenna', .54, .10)],
    'C25': [('ivory crown', .45, .41), ('ivory chin', .50, .89),
            ('left ear', .12, .69), ('right ear', .90, .69), ('dish', .64, .27)],
    'B05': [('ivory top', .50, .29), ('ivory side', .25, .52), ('ivory chin', .50, .80),
            ('left handle', .13, .43), ('right handle', .89, .43)],
    'B21': [('ivory top', .57, .36), ('ivory side', .80, .66), ('ivory chin', .50, .82),
            ('dish', .35, .18), ('ivory dish tip', .30, .10)],
    'B30': [('ivory top', .52, .22), ('ivory left', .21, .68), ('ivory chin', .50, .84)],
    'B35': [('ivory band left', .29, .56), ('ivory band right', .71, .60), ('ivory antenna base', .43, .23)],
    'B40': [('ivory crown', .50, .41), ('ivory cheek', .78, .76), ('ivory chin', .50, .85), ('ivory antenna tip', .63, .17)],
    'B07': [('dark shell', .28, .52), ('orange face', .67, .41)],
    'C46': [('ivory face', .50, .36), ('left ear', .12, .49), ('right ear', .88, .49), ('antenna', .64, .09)],
    'C07': [('headphone arch', .46, .20), ('ivory face', .50, .46), ('left ear', .09, .57)],
    'lead-clay': [('indigo head', .50, .23), ('green lobe', .80, .67), ('left eye', .33, .58)]
}
FLOOR = {'C41': (.50, .94), 'C22': (.50, .91), 'C25': (.50, .985),
         'B05': (.50, .93), 'B21': (.50, .965), 'B30': (.50, .94),
         'B35': (.50, .95), 'B40': (.50, .95), 'B07': (.50, .94),
         'C46': (.50, .92), 'C07': (.50, .96), 'lead-clay': (.50, .94)}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def patch(image, x, y, radius=3):
    px, py = int(x * image.width), int(y * image.height)
    return image.crop((px - radius, py - radius, px + radius + 1, py + radius + 1))


def pixels(path):
    with Image.open(path) as image:
        rgba = image.convert('RGBA')
        return rgba.size, hashlib.sha256(rgba.tobytes()).hexdigest()


def verify_rebuild(build, items, accepted_manifest):
    accepted = {item['id']: {key: pixels(ROOT / item[key])
                            for key in ['shipped', 'transparentMaster']} for item in items}
    build.main()
    rebuilt = json.loads((build.SOURCE / 'manifest.json').read_text())
    rebuilt_items = rebuilt['entries'] + [rebuilt['lead']]
    assert len(rebuilt_items) == len(items)
    encoding_fields = {'bytes', 'sha256', 'transparentMasterBytes', 'transparentMasterSha256'}
    for original, item in zip(items, rebuilt_items):
        assert {key: value for key, value in original.items() if key not in encoding_fields} == {
            key: value for key, value in item.items() if key not in encoding_fields}, item['id']
        for key in ['shipped', 'transparentMaster']:
            path = build.ROOT / item[key]
            assert pixels(path) == accepted[item['id']][key], (item['id'], key, 'rebuilt pixels changed')
            hash_key = 'sha256' if key == 'shipped' else 'transparentMasterSha256'
            bytes_key = 'bytes' if key == 'shipped' else 'transparentMasterBytes'
            assert digest(path) == item[hash_key] and path.stat().st_size == item[bytes_key], item['id']
    assert rebuilt['assetVersion'] == accepted_manifest['assetVersion']
    assert rebuilt['sourceMapSha256'] == accepted_manifest['sourceMapSha256']
    assert rebuilt['countIncludingLead'] == len(items) == 97
    assert rebuilt['totalPngBytesIncludingLead'] == sum(item['bytes'] for item in rebuilt_items)
    assert rebuilt['totalPngBytes'] == sum(item['bytes'] for item in rebuilt['entries'])
    assert rebuilt['totalTransparentMasterBytes'] == sum(item['transparentMasterBytes'] for item in rebuilt_items)
    for theme, background in [('light', '#f4f0e8'), ('dark', '#202328')]:
        with Image.open(build.SOURCE / ('alpha-review-' + theme + '.png')) as sheet:
            assert sheet.size == (12 * 192, 9 * 214)
            for index, item in enumerate(items):
                with Image.open(ROOT / item['shipped']) as image:
                    tile = Image.new('RGBA', image.size, background)
                    tile.alpha_composite(image.convert('RGBA'))
                    x, y = (index % 12) * 192, (index // 12) * 214 + 22
                    # Label font rasterization can vary; every portrait pixel must match.
                    assert ImageChops.difference(sheet.crop((x, y, x + 192, y + 192)).convert('RGB'), tile.convert('RGB')).getbbox() is None, (item['id'], theme)
    watched = list(build.SHIPPED.glob('*.png')) + list(build.TRANSPARENT_MASTERS.glob('*.png'))
    watched += list(build.SOURCE.glob('*review*.png'))
    watched += [build.SOURCE / 'manifest.json', build.TRANSPARENT_PROGRESS, build.SHIPPED / 'catalog.json']
    before = {str(path): digest(path) for path in watched}
    build.main()
    assert before == {str(path): digest(path) for path in watched}, 'Same-platform build is not idempotent'


def main():
    manifest = json.loads((SOURCE / 'manifest.json').read_text())
    progress = json.loads((SOURCE / 'transparent-progress.json').read_text())
    masks = json.loads((SOURCE / 'foreground-masks/manifest.json').read_text())
    originals = json.loads((SOURCE / 'source-preservation.json').read_text())
    items = manifest['entries'] + [manifest['lead']]
    ids = [f'{family}{n:02}' for family in ['B', 'C'] for n in range(1, 49)] + ['lead-clay']
    assert [item['id'] for item in items] == ids
    assert set(progress['entries']) == set(ids) == set(masks['entries'])
    assert manifest['assetVersion'] == 4 and progress['version'] == 9
    for filename, expected in originals['files'].items():
        assert digest(ROOT / filename) == expected, filename
        head = subprocess.check_output(['git', 'show', originals['baselineCommit'] + ':' + filename], cwd=ROOT)
        assert hashlib.sha256(head).hexdigest() == expected, filename
    points = 0
    for item in items:
        ident = item['id']
        original = Image.open(ROOT / item['master']).convert('RGB')
        master = Image.open(ROOT / item['transparentMaster'])
        shipped = Image.open(ROOT / item['shipped'])
        alpha = master.getchannel('A')
        assert master.mode == shipped.mode == 'RGBA' and shipped.size == (192, 192), ident
        assert master.size == original.size and alpha.getextrema() == (0, 255), ident
        assert shipped.getchannel('A').getextrema() == (0, 255), ident
        assert digest(ROOT / item['master']) == item['masterSha256'], ident
        assert digest(ROOT / item['transparentMaster']) == item['transparentMasterSha256'], ident
        assert digest(ROOT / item['shipped']) == item['sha256'], ident
        assert (ROOT / item['shipped']).stat().st_size == item['bytes'], ident
        assert (ROOT / item['transparentMaster']).stat().st_size == item['transparentMasterBytes'], ident
        assert digest(ROOT / item['foregroundMask']) == item['foregroundMaskSha256'], ident
        assert digest(ROOT / item['boundaryColors']) == item['boundaryColorsSha256'], ident
        # Interior preservation is exact at every opaque pixel, not a coverage count.
        unchanged = alpha.point([255 if value in (0, 255) else 0 for value in range(256)])
        diff = ImageChops.difference(original, master.convert('RGB'))
        for channel in diff.split():
            assert ImageChops.multiply(channel, unchanged).getbbox() is None, ident
        assert patch(alpha, .50, .992, 1).getextrema()[1] == 0, (ident, 'bottom backdrop')
        for label, x, y in FOREGROUND.get(ident, []):
            assert patch(alpha, x, y).getextrema()[0] >= 250, (ident, label, patch(alpha, x, y).getextrema())
            assert ImageChops.difference(patch(original, x, y), patch(master.convert('RGB'), x, y)).getbbox() is None, (ident, label, 'changed RGB')
            points += 1
        if ident == 'B07':
            assert alpha.getpixel((338, 226)) == 0, 'B07 manually reviewed exterior backdrop fringe'
        if ident in FLOOR:
            assert patch(alpha, *FLOOR[ident], radius=1).getextrema()[1] == 0, (ident, 'opaque floor')
    assert sum(item['bytes'] for item in items) == manifest['totalPngBytesIncludingLead']
    # Rebuild only scratch copies: other tests may concurrently read accepted assets.
    watched = [ROOT / item[key] for item in items for key in ['shipped', 'transparentMaster']]
    watched += [SOURCE / name for name in ['manifest.json', 'transparent-progress.json', 'alpha-review-light.png', 'alpha-review-dark.png']]
    before = {str(path): digest(path) for path in watched}
    spec = importlib.util.spec_from_file_location('avatar_build', ROOT / 'scripts/build-mate-avatars.py')
    build = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(build)
    with tempfile.TemporaryDirectory(prefix='avatar-build-test-') as folder:
        build.ROOT = Path(folder)
        build.SOURCE = build.ROOT / 'output/imagegen/clay-mates'
        shutil.copytree(SOURCE, build.SOURCE)
        build.SHIPPED = build.ROOT / 'lib/public/mate-avatars'
        shutil.copytree(ROOT / 'lib/public/mate-avatars', build.SHIPPED)
        metadata = build.ROOT / 'lib/public/modules/mate-avatar-catalog.js'
        metadata.parent.mkdir(parents=True)
        shutil.copyfile(ROOT / 'lib/public/modules/mate-avatar-catalog.js', metadata)
        build.MASTERS = build.SOURCE / 'masters'
        build.TRANSPARENT_MASTERS = build.SOURCE / 'transparent-masters'
        build.TRANSPARENT_PROGRESS = build.SOURCE / 'transparent-progress.json'
        verify_rebuild(build, items, manifest)
        # Force a different PNG encoding with identical pixels, then verify recovery.
        encoded = build.SHIPPED / 'C41.png'
        with Image.open(encoded) as image:
            image.save(encoded.with_suffix('.different.png'), format='PNG', compress_level=0)
        encoded.with_suffix('.different.png').replace(encoded)
        assert digest(encoded) != next(item['sha256'] for item in items if item['id'] == 'C41')
        verify_rebuild(build, items, manifest)
        # Independently corrupt a resumed output and prove the production path repairs it.
        build.TRANSPARENT_MASTERS = build.ROOT / 'corrupt-resume'
        build.TRANSPARENT_MASTERS.mkdir()
        build.TRANSPARENT_PROGRESS = build.TRANSPARENT_MASTERS / 'progress.json'
        scratch = {}
        source = build.SOURCE / 'masters/C41.png'
        _, entry = build.ensure_transparent_master(source, 'C41', masks, scratch)
        output = build.TRANSPARENT_MASTERS / 'C41.png'
        Image.new('RGBA', Image.open(source).size, (255, 255, 255, 0)).save(output)
        assert digest(output) != entry['outputSha256']
        _, repaired = build.ensure_transparent_master(source, 'C41', masks, scratch)
        assert digest(output) == entry['outputSha256'] == repaired['outputSha256']
    assert before == {str(path): digest(path) for path in watched}, 'Test changed accepted assets'
    print('verified 97 portraits;', points, 'source-selected foreground regions;', len(FLOOR), 'floor regions;', len(originals['files']), 'HEAD originals; idempotence; corrupt-resume repair')


if __name__ == '__main__':
    main()
