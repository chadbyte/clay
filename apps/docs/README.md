# Clay Studio Docs

This private workspace is the local Clay Studio Docs site. It uses Vinext's Pages Router compatibility layer with Vite.

## Run locally

From the repository root:

```sh
npm run docs:dev
npm run docs:build
npm run docs:preview -- --port 4318
```

The content loader is intentionally CommonJS (`lib/content.cjs`) because it is server-side code and uses `require`. The Vite/Vinext configuration and route components remain ESM because the framework requires that boundary.

The public guides are curated from the repository README and source. Internal `docs/` material is not published automatically.

## Deployment

Use Node.js 22.12 or newer. Set `PUBLIC_DOCS_ORIGIN` to the real public HTTP(S) origin before building; it must be an origin only, with no credentials, path, query, fragment, localhost, loopback, or private address:

```sh
export PUBLIC_DOCS_ORIGIN=https://docs.example.org
PATH=/path/to/node-22/bin:$PATH npm run docs:build
```

With a valid origin, the build writes absolute canonical/social metadata, a sitemap containing only public modern routes, and `robots.txt` with an absolute sitemap URL. Without one, local and preview builds emit `noindex,nofollow`, an empty sitemap, and `Disallow: /`; no localhost or invented domain is published.
