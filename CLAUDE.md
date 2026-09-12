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

## Driver and Split Worker model selection

- Keep task decomposition, architectural judgment, review, and independent verification with the Driver. Give the visible Split Worker concrete, bounded implementation tasks with clear acceptance criteria.
- For routine, bounded changes, recommend `codex` / `gpt-5.6-luna` / `low` when offered by the installed runtime catalog. Chad prefers this fast implementation and Driver review workflow over routinely recommending `gpt-5.6-sol` at high effort.
- Select model capability and thinking effort separately. Start with the lightest capable model and lowest adequate effort; do not default to Sol high or mirror the Driver's model.
- Explicitly fill vendor, model, and effort recommendation fields for creation and replacement, and explain why the choice fits the task. Check actual catalog availability and honor the user's runtime selection.
- Escalate only for a concrete task requirement or observed failure that the lighter Worker cannot handle adequately. State the reason, and reconsider a lighter model for the next bounded task. Small corrections found in review are not by themselves a reason to escalate.
- Independently verify the Worker's result and send implementation corrections back to the same visible Worker. Record outcomes to inform later choices; judge speed by the completed, verified result rather than the first draft alone.
