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
