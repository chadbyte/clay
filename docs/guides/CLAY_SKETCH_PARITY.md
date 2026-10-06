# clay-sketch Salt parity check

Checked 2026-10-06 against **PlantUML 1.2026.8**, commit
`149874a1bb2b64c42889d7178cb89f6647ac14bc`.

## Official-page coverage

All **40 source examples** from [the official Salt page](https://plantuml.com/salt)
are recorded unchanged in `test/fixtures/salt-official/`. Its manifest records
the retrieval date, page hash and individual source hashes. Of these, **35 are
standalone Salt diagrams**; five are activity diagrams or the Open Iconic catalog
(`official-27`, `official-32`–`official-35`). Those five are retained and explicitly
rejected as other diagram types; they are not counted as passing Salt comparisons.

The official examples exposed missing trees, tree tables, spanning cells, open
menus/dropdowns, scrollbars, rich Creole text, lists, colors, icons, pseudo-sprites,
images, page annotations, scale/DPI, background styles and handwritten geometry.
These examples now render with the native JavaScript implementation. Pixel tests
also exposed fractional-DPI SVG sizing differences, which have been corrected.

The complete corpus contains **100 sources**: 35 official Salt examples, 56
additional Salt comparisons, four Clay extensions rejected by the reference,
and the five other-diagram examples. Previous exclusions for trees, spans,
open dropdowns and scrollbars are now supported regression cases.

| Check | Result |
| --- | --- |
| Official standalone Salt examples | 35/35 exact geometry and zero differing pixels |
| All comparable sources | 91/91 rendered by both engines |
| Exact SVG dimensions and drawing primitives | 91/91 |
| Same-browser RGB pixel comparison | 91/91 with zero differing pixels |
| Text outside the canvas | None in the comparison corpus |
| Other diagram types on the official page | 5, explicitly rejected and outside Salt parity |
| Reference-rejected Clay extensions | 4, excluded from parity claims |

## Method and limits

References were generated with the real pinned JAR using identical source text.
Reference caching is allowed only when both JAR and input hashes match; native
output is always regenerated. Checked-in SVGs and a source-hash manifest live
in `test/fixtures/salt-reference/`. Regression tests compare every text, line,
rectangle, ellipse, polygon, path and image geometry, including formatting,
colors, stroke properties and text lengths. Filter IDs are normalized by their
actual definitions. PNG encoder bytes are not assumed identical: the browser
compares their decoded pixels as part of the complete image.

The gallery rasterizes both SVGs in the same browser at original dimensions
onto white canvases and compares every RGB pixel. This checks drawing order,
fonts, filters, image content and fractional scaling as well as geometry.
The PNG used by the official Creole example is recorded as a test fixture;
ordinary regression tests use those bytes and do not depend on the network.
Production image loading was also exercised against the original HTTPS URL.

This establishes equivalence for these sources and the pinned reference profile,
not complete PlantUML or universal Salt compatibility. Bundled measurements cover
SansSerif and Monospaced at 10, 12, 13, 14, 16, 18 and 20 points, in four styles,
using Java 15.0.2 on macOS. Browsers choose the actual glyphs for both SVGs.
Other Java/font installations may measure text differently. Complex shaping,
bidirectional layout, supplementary-plane glyph metrics, arbitrary fonts/sizes,
other UML types, macros/includes, general PlantUML sprites and themes are outside
scope. Handwritten parity covers the official lines/rounded-rectangle example,
not all possible handwritten shape combinations. See [runtime boundaries](PLANTUML_PREVIEW.md).

The four extensions are a quoted field containing pipe/braces, the legacy
`@startuml` + `salt` wrapper, and bare horizontal/vertical root tab bars. Reference
1.2026.8 rejects or crashes on these inputs; Clay retains them for compatibility.
Correctly wrapped tab bars are separately compared successfully.

Browser integration checks with an empty executable PATH pass for inline chat,
revisions, history, Save/conflicts, Download, panel switching, fullscreen, session
changes, Fit, stale requests, file previews, source mode, watched updates,
navigation, cancellation and error display. Image-specific tests verify embedded
PNG output, limits, cancellation, DNS pinning, private-address rejection and
redirect rejection. No runtime JAR, Java, Graphviz or additional package is used.

## Reproduce

Ordinary offline regression checks:

```sh
node --test test/salt-parity.test.js test/salt-images.test.js test/plantuml-renderer.test.js
```

For fresh reference generation, use an existing JAR. This developer-only check
installs nothing:

```sh
node scripts/check-salt-parity.js /path/to/plantuml-1.2026.8.jar /tmp/clay-salt-parity
python3 -m http.server 61189 --bind 127.0.0.1 --directory /tmp/clay-salt-parity
```

Open `http://127.0.0.1:61189/` in the shared Browser panel. The gallery shows each
pair, pixel counts and a red difference image. Its status contains all pixel
results. `report.json` records input and renderer/asset hashes, reference errors
and dimensions. The CLI checks acceptance, dimensions and words; a zero exit
alone is **not** a pixel-parity result. Use `--reuse-reference` only for cached
references whose input and JAR hashes still match.

Reference JAR SHA-256:
`3629c9cd017c7f73e6450396eea0040216c7e1eef8473ce33cc1aad469dab2f9`.
Graphviz is not needed for Salt. The version command's Graphviz/Times warnings
do not replace per-diagram exit-status and diagram-type validation.

To reproduce all bundled metrics, icons and colors with the same pinned source,
Java and font environment, export into a separate directory and compare hashes:

```sh
node scripts/export-salt-assets.js /path/to/plantuml-1.2026.8.jar /path/to/plantuml-source /tmp/salt-assets
```

The font assets contain numerical measurements, not outlines. Their provenance
and encoding are recorded in `lib/assets/salt-font-metrics.json`; icon/color
provenance is in `lib/assets/salt-assets.json`. Adaptation and asset licenses are
recorded in [LICENSES/README.md](../../LICENSES/README.md).
