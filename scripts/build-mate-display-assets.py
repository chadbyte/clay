"""Build lightweight display copies from preserved PNG/JPEG assets (requires Pillow)."""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1] / 'lib/public'


def build(source, max_width):
    with Image.open(source) as original:
        image = original.convert('RGBA')
        if image.width > max_width:
            image = image.resize(
                (max_width, round(image.height * max_width / image.width)),
                Image.Resampling.LANCZOS,
            )
        output = source.with_suffix('.webp')
        image.save(output, 'WEBP', quality=82, method=6, exact=True)
        return source.stat().st_size, output.stat().st_size


def main():
    sizes = [build(source, 192) for source in sorted((ROOT / 'mate-avatars').glob('*.png'))]
    sizes += [build(ROOT / 'mates' / name, 192) for name in ['ally.png', 'scout.png', 'sage.jpg']]
    # Keep enough pixels for high-density displays at the existing CSS dimensions.
    sizes += [build(ROOT / 'welcome-art' / name, width) for name, width in [
        ('conversation-desk.png', 630), ('mate-clay.png', 768), ('project-clay.png', 768),
    ]]
    print(f'{len(sizes)} assets: {sum(before for before, after in sizes):,} -> '
          f'{sum(after for before, after in sizes):,} bytes')


if __name__ == '__main__':
    main()
