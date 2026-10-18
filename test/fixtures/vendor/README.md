# Test-only vendored assets

`lucide-0.468.0.umd.js` is the unmodified Lucide 0.468.0 UMD build (ISC; the file keeps its
upstream `@license lucide v0.468.0 - ISC` header). The page loads exactly this version from
`https://cdn.jsdelivr.net/npm/lucide@0.468.0/dist/umd/lucide.min.js` (`lib/public/index.html`).
Browser tests serve it through `test/fixtures/offline-cdn-routes.cjs` so they need no network;
production icon rendering is not replaced.

`LICENSE-lucide.txt` is the exact Lucide license (ISC with the MIT-licensed Feather portions) at the
0.468.0 release tag: https://raw.githubusercontent.com/lucide-icons/lucide/0.468.0/LICENSE

SHA-256 of `lucide-0.468.0.umd.js`: `3411692820cb8d47543f69496aa25fd603a358f4498046f41c508a5a3342210e`.

This directory lives under `test/`, which is outside the npm `files` allowlist
(`bin/`, `lib/`, `LICENSES/`), so it is not published.
