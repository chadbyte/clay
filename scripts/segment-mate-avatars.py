"""Generate local foreground masks, independently of the asset packaging build."""
from pathlib import Path
from PIL import Image
import argparse
import hashlib
import importlib.metadata
import json
import os
import time

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'output/imagegen/clay-mates'
MASKS = SOURCE / 'foreground-masks'
MODEL = 'birefnet-general'
MODEL_URL = 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/BiRefNet-general-epoch_244.onnx'


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--ids', nargs='+', required=True, help='Explicit reviewed pilot IDs, or all after pilot review')
    args = parser.parse_args()
    ids = [f'{family}{n:02}' for family in ['B', 'C'] for n in range(1, 49)] + ['lead-clay']
    selected = ids if args.ids == ['all'] else args.ids
    assert all(ident in ids for ident in selected), 'Unknown portrait ID'
    from rembg import new_session
    from rembg.bg import alpha_matting_cutout
    import numpy as np
    from mate_avatar_edge import clean_boundary
    session = None
    model_path = Path(os.environ.get('U2NET_HOME', str(Path.home() / '.u2net'))) / (MODEL + '.onnx')
    if not model_path.exists():
        session = new_session(MODEL, providers=['CPUExecutionProvider'])
    model = {'name': MODEL, 'url': MODEL_URL, 'sha256': digest(model_path),
             'bytes': model_path.stat().st_size, 'provider': 'CPUExecutionProvider',
             'inputSize': [1024, 1024], 'rembg': importlib.metadata.version('rembg'),
             'onnxruntime': importlib.metadata.version('onnxruntime')}
    MASKS.mkdir(exist_ok=True)
    (MASKS / 'raw').mkdir(exist_ok=True)
    (MASKS / 'boundary').mkdir(exist_ok=True)
    manifest_path = MASKS / 'manifest.json'
    previous = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    entries = previous.get('entries', {}) if previous.get('model') == model else {}
    processing = {'method': 'closed-form alpha matting', 'foregroundThreshold': 240,
                  'backgroundThreshold': 10, 'erodeSize': 2,
                  'rgbPolicy': 'Original RGB at alpha 0 and 255; estimated foreground color only at fractional-alpha boundary pixels.',
                  'edgeDecontamination': {'coreErosionPixels': 2, 'maxDistancePixels': 2.9,
                                         'minimumRgbDistance': 35, 'maximumBackdropMixResidual': 20,
                                         'backdropMixRange': [.05, .98]}}
    override_path = MASKS / 'overrides.json'
    overrides = json.loads(override_path.read_text()) if override_path.exists() else {}
    for group in overrides.values():
        for override in group:
            assert digest(ROOT / override['mask']) == override['sha256'], 'Changed manual override'
    processing['overridesSha256'] = digest(override_path) if override_path.exists() else None
    processing['implementationSha256'] = {filename: digest(ROOT / filename) for filename in [
        'scripts/segment-mate-avatars.py', 'scripts/mate_avatar_edge.py',
        'scripts/mate-avatar-segmentation-requirements.txt']}
    processing['dependencies'] = {name: importlib.metadata.version(name) for name in ['pymatting', 'numpy', 'scipy', 'Pillow']}
    for ident in selected:
        source = SOURCE / 'masters' / (ident + '.png')
        output = MASKS / (ident + '.png')
        source_hash = digest(source)
        entry = entries.get(ident, {})
        boundary_path = MASKS / 'boundary' / (ident + '.png')
        raw_path = MASKS / 'raw' / (ident + '.png')
        if (previous.get('processing') == processing and output.exists() and boundary_path.exists()
                and entry.get('sourceSha256') == source_hash and entry.get('sha256') == digest(output)
                and entry.get('boundarySha256') == digest(boundary_path)
                and raw_path.exists() and entry.get('rawSha256') == digest(raw_path)):
            print(ident, 'verified saved mask', flush=True)
            continue
        started = time.monotonic()
        image = Image.open(source).convert('RGB')
        if raw_path.exists() and entry.get('sourceSha256') == source_hash and entry.get('rawSha256') == digest(raw_path):
            raw = Image.open(raw_path)
        else:
            if session is None:
                session = new_session(MODEL, providers=['CPUExecutionProvider'])
            raw = session.predict(image)[0]
            raw.save(raw_path, optimize=True)
        cutout = alpha_matting_cutout(image, raw, 240, 10, 2)
        cutout, decontaminated_pixels = clean_boundary(image, cutout)
        mask = cutout.getchannel('A')
        for override in overrides.get(ident, []):
            override_mask_path = ROOT / override['mask']
            assert override['sourceSha256'] == source_hash
            assert override['sha256'] == digest(override_mask_path)
            assert override['kind'] == 'background'
            override_mask = Image.open(override_mask_path)
            assert override_mask.mode == 'L' and override_mask.size == mask.size
            mask.paste(0, (0, 0), override_mask)
        cutout.putalpha(mask)
        mask.save(output, optimize=True)
        # Save decontaminated colors only in the uncertain alpha band.
        alpha = np.asarray(mask)
        fractional = (alpha > 0) & (alpha < 255)
        boundary = np.zeros((*alpha.shape, 4), dtype=np.uint8)
        boundary[fractional, :3] = np.asarray(cutout)[fractional, :3]
        boundary[fractional, 3] = 255
        Image.fromarray(boundary).save(boundary_path, optimize=True)
        entries[ident] = {'source': str(source.relative_to(ROOT)), 'sourceSha256': source_hash,
                          'mask': str(output.relative_to(ROOT)), 'sha256': digest(output),
                          'size': list(mask.size), 'bytes': output.stat().st_size,
                          'rawMask': str(raw_path.relative_to(ROOT)), 'rawSha256': digest(raw_path),
                          'boundary': str(boundary_path.relative_to(ROOT)), 'boundarySha256': digest(boundary_path),
                          'boundaryPixels': int(fractional.sum()),
                          'edgeDecontaminatedPixels': decontaminated_pixels, 'overrides': overrides.get(ident, [])}
        temporary_manifest = manifest_path.with_name('.manifest.json.tmp')
        temporary_manifest.write_text(json.dumps({'version': 1, 'model': model,
                                            'processing': processing,
                                            'entries': dict(sorted(entries.items()))}, indent=2) + '\n')
        temporary_manifest.replace(manifest_path)
        print(ident, round(time.monotonic() - started, 1), 'seconds', flush=True)


if __name__ == '__main__':
    main()
