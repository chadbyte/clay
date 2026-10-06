# Licensing scope

Clay Studio as a whole is licensed under the GNU Affero General Public License, version 3 only (AGPL-3.0-only), under the terms in the root [LICENSE](../LICENSE). This project-wide license does not narrow the grants that apply to preexisting portions previously covered by the project’s MIT license.

Preexisting MIT-covered portions retain the grants and applicable copyright and permission notices from the MIT license. The byte-for-byte prior license text is preserved in [MIT-legacy.txt](MIT-legacy.txt), and this notice does not revoke or alter those earlier grants or notices.

Third-party components and assets retain their own licenses and notices. In particular, the bundled Source Serif 4 font remains under the [SIL Open Font License 1.1](../lib/public/fonts/source-serif-4/LICENSE.md).

The Salt layout, control geometry, text decoration, color map and diagram chrome
in `lib/salt-*.js` and `lib/assets/salt-colors.json` are adapted from PlantUML
1.2026.8, copyright 2009–2025 Arnaud Roques, under
[GPL-3.0-or-later](plantuml-salt.txt). The handwritten geometry also credits
original author Adrian Vogt. Corresponding source:
https://github.com/plantuml/plantuml/tree/v1.2026.8/src/main/java/net/sourceforge/plantuml.

The normalized Open Iconic SVG paths in `lib/assets/salt-icons.json` retain the
[MIT license, copyright 2014 Waybury](open-iconic.txt). Upstream:
https://github.com/iconic/open-iconic. The paths were exported through the pinned
reference renderer; `scripts/export-salt-assets.js` reproduces the conversion.
Bundled font assets contain numerical measurements only, not font outlines.

The bundled UI fonts [Geist](../lib/public/fonts/geist/LICENSE.txt) (geist 1.7.2) and [Noto Sans KR](../lib/public/fonts/noto-sans-kr/LICENSE.txt) (@fontsource-variable/noto-sans-kr 5.3.0, Google Fonts v39) also retain the SIL Open Font License 1.1. Their WOFF2 files are distributed unchanged; the Korean font uses its original Unicode subsets for on-demand loading.
