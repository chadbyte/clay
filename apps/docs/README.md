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
export PUBLIC_DOCS_CHANNEL=stable
PATH=/path/to/node-22/bin:$PATH npm run docs:build
```

Only an explicit `stable` build with a valid origin allows indexing and emits a populated sitemap. Beta and preview builds emit `noindex,nofollow`, an empty sitemap, and `Disallow: /`, even with a public origin. Valid origins still supply canonical/social metadata.

### Documentation channels

The shared sidebar contains a Stable / Beta switcher. On mobile, open the navigation menu to find it. Switching opens the selected channel's overview, since a newer guide may not exist in the older channel. Unconfigured or invalid destinations are disabled; no deployment address is inferred.

| Build variable | Purpose |
| --- | --- |
| `PUBLIC_DOCS_CHANNEL` | `stable` or `beta`; omitted or unrecognized values show Preview and disable indexing. |
| `PUBLIC_DOCS_ORIGIN` | Public origin of this build. |
| `PUBLIC_DOCS_STABLE_ORIGIN` | Stable destination, using the same origin validation. |
| `PUBLIC_DOCS_BETA_ORIGIN` | Beta destination, using the same origin validation. |
| `PUBLIC_DOCS_VERSION` | Optional release version or short revision label, such as `v5.4.0-beta.1`. Set from the exact build revision; no version is inferred. |

For a public stable or beta build, its own origin overrides that channel's destination. Equal destinations are disabled to avoid presenting the same site as two channels. Configuration is captured during the build and used consistently by all pages; changing it requires a rebuild. For local development, rebuild after changing channel configuration.

Build beta from the selected main commit and stable from the exact successful stable-release tag. Set both destination origins on both deployments. The example domain above is only a placeholder; the channel deployment setup below provides the actual destinations.

### Vercel automation

Two independent Vercel projects serve the manual:

| Channel | Project | Origin | Source |
| --- | --- | --- | --- |
| Beta | `clay-docs-beta` | `https://clay-docs-beta.vercel.app` | The main push revision, after its Beta release job succeeds, even if no package version was published. |
| Stable | `clay-docs-stable` | `https://clay-docs-stable.vercel.app` | The exact published stable tag selected by the successful Stable release job. |

`.github/workflows/release.yml` calls the reusable `docs-deploy.yml` workflow directly. This avoids relying on a `release.published` event from a release created with `GITHUB_TOKEN`, which does not start another workflow. Stable selection checks the package version, a tag at the release commit, and the published GitHub release; drafts and prereleases are rejected. A release run that creates no stable tag does not deploy Stable. The existing release concurrency group also serializes these deployments.

Set these GitHub Actions repository variables:

- `DOCS_VERCEL_ORG_ID`: Vercel team ID.
- `DOCS_BETA_VERCEL_PROJECT_ID` and `DOCS_STABLE_VERCEL_PROJECT_ID`: the corresponding project IDs.
- `DOCS_BETA_ORIGIN` and `DOCS_STABLE_ORIGIN`: the origins above, or verified custom domains.

Set `DOCS_BETA_VERCEL_TOKEN` and `DOCS_STABLE_VERCEL_TOKEN` as repository **secrets**. Use Vercel deployment tokens with the narrowest available scope and track their expiration. An interactive CLI login is not a GitHub Actions credential. Never put tokens in source files or workflow variables. If only a team-scoped token is available, the same token can populate both secrets. Rotate both secrets before it expires.

The workflow installs locked dependencies, runs the manual tests, pulls the exact project's settings, builds with `NITRO_PRESET=vercel`, and deploys the prebuilt output. Nitro is pinned because the Vinext adapter currently uses its version 3 beta. The build includes only the curated public Markdown needed by the server function. Normal local builds still use `vinext start`.

Merge the workflow and adapter changes into main to activate Beta automation. Stable becomes available after those changes reach the release branch through the normal promotion process and a stable release succeeds. Do not publish the unreleased main manual under Stable just to populate its URL. Until the first Stable deployment, its reserved origin may not serve a manual.

For a failed deployment, inspect the failed docs job and rerun that job after correcting the configuration. A docs deployment failure does not undo a package release. Keep both origins consistent when changing domains; they are embedded at build time. Check the home page, a guide, a missing route, channel links, images, and `robots.txt` after deployment. Beta must remain noindex; Stable must identify the release tag and use its own canonical origin.
