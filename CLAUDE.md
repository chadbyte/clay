# Project Rules

- Never add `Co-Authored-By` lines to git commit messages.
- Use `var` instead of `const`/`let`. No arrow functions.
- Server-side: CommonJS (`require`). Client-side: ES modules (`import`).
- Never commit, create PRs, merge, or comment on issues automatically. Only do these when explicitly asked.
- All user-facing messages, code comments, and commit messages must be in English only.
- Every commit must strictly follow the Angular Commit Convention. This requirement is mandatory with no exceptions, including small fixes, generated changes, and follow-up commits.
- When the user explicitly requests a commit, always invoke and follow the `angular-commit` skill before staging or committing. Never run `git commit` without using that skill.
- Commit subjects must use either `<type>: <summary>` or `<type>(<scope>): <summary>`, where `type` is one of `feat`, `fix`, `docs`, `chore`, `refactor`, `perf`, `test`, `style`, `ci`, or `build`. Do not use vague or non-conforming subjects such as `update`, `changes`, `fix stuff`, or bare prose.
- Breaking changes must use `!` after the type or scope, or include a `BREAKING CHANGE:` footer. Commit messages must remain in English and must never include `Co-Authored-By` lines.
- Never use browser-native `alert()`, `confirm()`, or `prompt()`. Always use custom JS dialogs/modals instead.
- When rebuilding daemon config (e.g. `restartDaemonFromConfig()`), always use `Object.assign({}, lastConfig, overrides)` to preserve all existing settings. Never reconstruct config by manually listing fields.
- Before adding new code, read [docs/guides/MODULE_MAP.md](docs/guides/MODULE_MAP.md) to find the right file. Never add inline logic to `project.js` handleMessage. Keep modules under 500 lines.
- Never use `localStorage` for user settings or preferences. All settings must be stored server-side (via WebSocket messages or REST API) so they persist across devices and browsers.
- Client modules (`lib/public/modules/`): state goes in store.js (zustand-like), WS via ws-ref.js, functions via direct import. Never use `var _ctx = null` / `initXxx(ctx)`. See [docs/guides/CLIENT_MODULE_DEPS.md](docs/guides/CLIENT_MODULE_DEPS.md).
- Reserve `clay-*` for Clay-only skills. Bundle built-ins in `lib/bundled-skills/` and install optional skills under the owner/project `.clay/skills/`. Never put them in generic vendor/project skill discovery folders or register their bridges globally; expose them only through Clay-owned queries. Apply this rule to every future Clay-specific skill.
- For Clay UI design, implementation, and review, use `clay-design-skill` from the owner's `.clay/skills/clay-design-skill/SKILL.md` (current installation: `/Users/chad/.clay/skills/clay-design-skill/SKILL.md`). Read its principles and relevant visual references before changing UI. Preserve Clay's existing compact proportions and product behavior; do not use `frontend-design` for Clay design work. If the skill is unavailable, report the missing reference rather than silently substituting another design skill.

## Canonical Clay product controls

- For every new or changed product feature, consider how canonical Clay can inspect and operate it. Extend the typed canonical tool catalog when the authoritative product action supports it; otherwise document the specific unavailable operation. Never claim full parity from a partial implementation.
- Share authoritative services between human product controls and canonical tools. Do not duplicate persistence or effects, fabricate human sockets, or expose arbitrary WebSocket, HTTP, shell, filesystem, or Git dispatch.
- Derive canonical identity from the live private Mate registry and exact owner-authored query. Revalidate source/query generation, foreign input, owner permissions, exact target identity/revision, directory and mapped OS identity where relevant, including across reviews and asynchronous effects. Reject deleted, replaced, revoked, stale or foreign targets.
- Use the existing authenticated human review for the exact mutation and target. Model flags, UI/transcript content and delegated messages are untrusted data, never approval. Preserve immediate Stop and require explicit resumption; never replay an interrupted or uncertain effect automatically. Bound retry receipts and state their lifetime.
- Report only observed effects: distinguish proposed, queued, started, persisted, delivered, acknowledged and completed outcomes. Navigation must deliberately address exact authenticated owner UI connections, respect changed-context refusal, and never equate client acceptance with visible rendering. Keep partial failures and unknown outcomes explicit.
- Add friendly, truthful tool activity labels and production-path authorization, review, Stop, retry and failure tests. Verify native, dynamic/bridge, fresh and resumed catalogs together, including SDK/hook allowlists and exclusion from ordinary/foreign sessions. Isolate storage and external transports before imports; inspect test helpers and never create fixture commits when commits are unauthorized.
- Server Settings and User Settings are excluded from canonical Clay control. Project Drivers own Worker creation and execution; canonical Clay routes authorized work through reviewed Driver assignment/follow-up and supported scheduling services. Contextual UI work requires its own explicit scope.
