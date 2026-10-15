# YOKE runtime and query contracts

Clay selects providers by registration identity. Execution options, SDK/file formats, authentication grammar, installation resolution and recovery protocols are implemented under `lib/yoke`. Common code owns product policy, persistence, human rendering and authorization. A provider declaration never grants owner, foreign-input, canonical registry/query-generation, target revision or human review authority.

The authoritative interface reference is `lib/yoke/interface.js`. `provider-contract.resolve()` selects an actual live `providerContract` or its init-free registry entry. `session-tool-transport.contract()` selects the live `queryContract` or registry contract. An independent registry key can use an implementation without inheriting a vendor-name branch.

## Implemented boundaries

| Area | YOKE implementation | Common caller responsibility |
| --- | --- | --- |
| Execution and title options | `query-options`, `options/*`; Claude, Codex, ACP, Kiro and Antigravity map validated common intent into their real SDK envelopes | Build execution intent; validate/persist settings; curator read-only policy; exact query admission |
| Permission/thinking/effort/approval/sandbox/search controls | Serializable `configuration`, model metadata, provider settings codec; registry `publicInfo()` allowlist | Render existing controls, send typed setting messages, persist accepted changes; permission/review authority stays server-side |
| Context and billing | `usage` normalizes accounting and observed/estimated/unavailable context; missing or inflated measurements are unavailable | Persist normalized snapshots, render zero/unknown accurately, aggregate billing separately from occupancy |
| Quota restore | Adapter account snapshots plus normalized history projection; source-less legacy account events can be marked ignored by the implementation | Replay common account snapshots and retain owner/session scoping |
| Installation and startup discovery | `discovery`, actual executable resolvers and ACP profiles; adapter startup shares the same resolver | Filter authorized mapped OS identity and configured runtime choices; no provider process for discovery |
| Authentication and sign-in | `auth-events`, `errors`, `login-protocol`, registered known commands and exact OAuth hosts | Authenticate owner/socket, authorize the exact terminal/flow and revalidate async completion; no arbitrary command dispatch |
| MCP source files and plugins | `mcp-source-*`, `mcp-tool-policy-normalize`; provider TOML/JSON/plugin grammar and config roots | Live owner/OS mapping checks, scan revision, selection review, persistence and enforcement |
| MCP SDK protocol | `sdk-mcp-descriptors`, `mcp-proxy`, `sdk-server-factory`, actual worker implementation | Provide authorized product tool handlers and consume opaque serializable projections |
| Unanswered delivery | `response-recovery` selects actual `recoveryFactory`; Claude implementation owns its confirmed termination/retry protocol | Exact session/handle/query-generation guards, immediate Stop, explicit resumption, durable outcomes |
| Recovery signals and errors | Adapter-emitted normalized recovery/plan/error events; host transient state is provider-neutral | Safe admission and truthful delivery status; no uncertain effect replay |
| Process/isolation protocol | `providers/claude-process`, bounded provisioning and maintenance services | OS identity, exact PID/target admission, authorized provisioning/cleanup policy |
| Legacy terminal transcripts and GUI transition | `legacy-sessions`, `cli-sessions`, watcher/index/hygiene implementations and actual resume capability | Import/delete/persist Clay records, enforce idle/Stop/identity checks before changing runtime |
| Notification hooks and permission pattern encoding | Actual YOKE hook installer and permission codec; old entrypoints are compatibility exports | Choose installation policy and user-authored allow rules; preserve mandatory permission/catalog checks |
| Imported skill format | `source-locations`, `clay-skill-install` and existing skill discovery | Clay-only private skill boundaries and project/owner storage policy |

These are implemented services, not a switch moved into a host helper. Provider-specific filesystem and SDK parsing remains inside YOKE where it belongs. Existing ACP/Kiro/Antigravity behavior is mapped without claiming native SDK tools, thinking controls, isolation or recovery they do not implement. Muse now implements the same boundaries through an independent registry entry and public MSP Connection/Session adapter; its supported, unsupported and untested surface is recorded in [MUSE_YOKE_CONTRACTS.md](MUSE_YOKE_CONTRACTS.md).

## Query catalogs, lifecycle and failure

`toolTransport` describes SDK MCP, dynamic definitions or stdio MCP. Unknown and invalid kinds normalize to `none`, including admission paths which test `kind`. A declared SDK MCP provider with requested native schedule/question definitions must supply a callable `createToolServer` and a non-null server. Missing, nonfunction and failed factories reject startup. Unsupported adapters retain their unrelated ordinary tools.

`catalogLifetime`, `catalogVersion(session, family)` and `recordCatalog(session, versions)` govern resumed tools and confirmed markers. Claude mounts SDK MCP definitions for each query. Codex persists dynamic definitions with the original conversation, so resumed Knowledge, Linear, browser, Issues, questions, Mate schedules and external definitions use an exact-session/query bridge when required. External dynamic definitions retain their live authorization. No new canonical product action or catalog is added.

Codex's adapter contract owns the mapping to persisted `codexDynamicToolCatalogVersion`, `codexUserInputToolCatalogVersion`, `codexSharedBrowserToolCatalogVersion`, `codexIssuesToolCatalogVersion`, `codexYouToolCatalogVersion` and `codexLinearToolCatalogVersion`. Clay keeps those existing serialized fields for backward compatibility. `CODEX_CATALOG_VERSION` remains a compatibility export; common code uses `SCHEDULE_CATALOG_VERSION`.

A missing revision reader means unknown. A missing writer never confirms success. Catalog markers are written only after a matching live `session_started` event, never merely after handle creation or on a resumed session. Native MCP override support requires both a semantic declaration and an actual handle setter. Invalid permission-mode declarations do not grant Auto. Structured input mode/guidance and interruption text come from the implemented query contract.

Recovery factories must implement every lifecycle method; malformed factories throw. Unsupported adapters get no synthesized retry. A session is bound to the original recovery manager for immediate Stop. Replacement providers invalidate that manager's pending work. Claude's one retry still requires verified termination; Codex recovery admission remains adapter-side. Uncertain effects are never replayed automatically. Deleted/replaced sessions, retired handles, foreign input, stale query generations, exact review and target revisions are revalidated in shared authoritative services.

## Serializable descriptions and bounded operations

`publicInfo()` exposes an explicit product-description allowlist; backend callbacks, factories and OAuth internals are excluded. UI controls consume actual supported choices and model effort metadata. Existing field/message names such as `codex_config` are compatibility persistence APIs, not runtime protocol decisions. Login/resume display commands and plan path hints come from provider metadata. Claude model descriptions preserve the existing Sonnet beta hint inside the provider implementation; common UI code no longer infers it from model names. No browser-native dialogs or new settings storage are introduced.

YOKE login operations accept only known registered token-only commands. Browser login additionally requires a registered exact host, HTTPS, PKCE/state and a loopback redirect. Host flow ownership/review is unchanged. Discovery honors supported explicit binary overrides before fallbacks and does not leak daemon installations into mapped OS accounts. Unknown isolation support is refused. Missing context support returns unavailable, never fabricated zero or an assumed context window.

## Residual non-YOKE references

The exhaustive categorized source inventory is [YOKE_HOST_INVENTORY.md](YOKE_HOST_INVENTORY.md). Remaining names are provider identity/defaults, deliberate Worker/model-tier policy, human branding, persisted compatibility APIs, Clay-owned legacy storage or imports of actual YOKE services. They do not implement provider execution envelopes, login/config parsers or recovery protocols outside YOKE. Legacy proxy entrypoints remain for existing imports/process paths; their implementation is inside YOKE.

## Verification

The guarded regression runner includes the accepted original 404-test coverage and expanded production bridge, catalog/review/Stop, usage, UI-controller, login/discovery, recovery, registered-adapter, MCP connection, skill storage and worker IPC suites:

```sh
sh test/helpers/run-yoke-contract-regressions.sh
```

The runner pins `/Users/chad/.nvm/versions/node/v22.22.1/bin/node`, creates temporary HOME/CLAY_HOME/CODEX_HOME before imports and preloads `test/helpers/yoke-no-provider-processes.cjs`. Runtime dependency probes which intentionally launch providers are excluded by `--test-skip-pattern='runtime dependency'`. Fixtures were inspected for isolated storage and fake transports before running. Provider binaries, package launchers, SDK worker spawns/forks and Git commits/remote mutations are blocked. The deliberately fake skill-installer subprocess uses a temporary fake executable; it does not install a real skill or contact a provider.

An expanded pre-final run passed 696 tests, zero failures, exit 0. The original expanded 61-suite runner passed **742 tests, zero failures, zero cancellations, exit 0** (`/tmp/clay-yoke-all-final.tap`); the discovery-boundary follow-up passed **760 tests across 64 test files, zero failures, exit 0** (`/tmp/clay-yoke-discovery-full.tap`). Live models, real authentication/provider startup, mapped OS provisioning and visual browser rendering are outside this verification boundary. No daemon was restarted, no commit or remote mutation was made, and no parity is claimed for unsupported provider features.

Static verification: `git diff --check` exited 0; Node 22 `--check` passed every changed/new JavaScript file. Every new YOKE module is below 500 lines. One new MCP admission fixture initially omitted its existing production dependency `getEnabledMcpServers`; that fixture was corrected, its admission assertions retained, and the entire 61-suite set rerun successfully.

## Discovery boundary follow-up

Antigravity discovery and real adapter init now call the same `providers/antigravity-executable.resolve` implementation. Explicit missing, empty, nonexecutable or directory overrides fail closed before PATH lookup or model fetching. Valid overrides select the same path; mapped OS users remain refused. The production init regression injects only model fetching and stubs `which`/`where`, with isolated storage and the process blocker preloaded. No provider is launched.

The audit found the shared bundled wrapper could add a PATH fallback after a runtime resolver failed. That wrapper now delegates fallback policy entirely to the actual runtime resolver. Claude, Codex, Kiro and ACP overrides use shared regular-file/access validation and reject invalid explicit selections. Native entries require executable access; Claude SDK JavaScript entries require readable regular files and retain support without an execute bit. Mapped-user lookup still uses the mapped account rather than daemon overrides.

Risk-focused residual inspection also corrected generic fork-history selection: `session-history.read` dispatches an actual registered reader, while unsupported or malformed readers refuse instead of assuming Claude JSONL or fabricating empty history. Existing local-history forks and host owner/target/async revalidation remain intact. The Claude quota overage alias is normalized in its adapter before the common product processor consumes the event. Independent provider-name reader and quota normalization regressions cover these boundaries.

Verification commands: `sh test/helpers/run-yoke-contract-regressions.sh` (64 files, 760 passed, exit 0); targeted Node 22 guarded discovery/runtime/Antigravity/spawn/Codex routing run (54 passed, exit 0); `git diff --check` (exit 0); Node 22 `--check` across changed/new JavaScript (exit 0). No live provider, auth or provisioning behavior is claimed.

## Muse integration verification

The Muse port retains the common native/dynamic contracts and adds the query-scoped stdio implementation on both start and resume. The shared bridge now constructs its server config after incrementing the query generation. Shared fork handling consumes the observed `useLocalHistory` result rather than selecting a vendor parser. Title collection awaits cleanup, and account snapshots retain an available observation timestamp.

The guarded runner now includes Muse protocol and installation tests: **824 tests across 66 files passed, zero failures/cancellations, exit 0** (`/tmp/clay-muse-verified.tap`). See [MUSE_YOKE_CONTRACTS.md](MUSE_YOKE_CONTRACTS.md) for exact SDK evidence, commands, unsupported operations and live-verification limits. No new canonical product action is added; the existing 28 controls retain fresh/resumed Muse bridge coverage with foreign-input exclusion.

## Image input, output and invocation

`pushMessage(text, images)` is image **input**. The optional `generated_image` event is image **output**, now explicitly documented in `lib/yoke/interface.js`: observed base64 bytes plus media type/tool identity and optional observed provenance. Its historical name covers provider-produced artifacts and does not certify model generation. Codex already normalizes its native imageGeneration item to this event; `sdk-message-processor.js` consumes it without a vendor branch, persists references and delivers project URLs. That path and its existing tests are preserved.

Muse can expose a typed raster outputRef through its public `item/readOutput` byte API. The adapter maps only complete bounded bytes into the same event, never metadata/path guesses or input echoes. Dedicated image-generation invocation is a separate capability: neither the existing YOKE interface nor Muse's stable method union provides `generateImage()`. See the Muse matrix for supported artifact output and unavailable invocation/provenance guarantees.

Image follow-up verification: `sh test/helpers/run-yoke-contract-regressions.sh` passed **834 tests across 67 files**, zero failures/cancellations/skips, exit 0 (`/tmp/clay-muse-images-final.tap`). Node 22 syntax checks passed all 27 changed/new JavaScript files; `git diff --check` passed. No live image-generation provider was invoked.

## Muse fork and title review corrections

Muse declares a completed-turn-inclusive native fork boundary. Shared `session-fork-history.js` preflights its exact local marker/completion before any provider effect; the SDK bridge carries the resulting end index to the shared history service. This includes the selected response while excluding later turns, with ambiguous/missing boundaries refused before native mutation. Undeclared providers retain existing behavior.

Title cleanup now shares the request's overall deadline: close is initiated and rejection observed, but an unresponsive close cannot prevent settlement. Incomplete/failed title requests are never accepted; pending teardown is not claimed as terminated. The updated guarded suite passed **848 tests across 67 files**, zero failures/cancellations/skips, exit 0 (`/tmp/clay-muse-review-fixes.tap`). See the Muse coverage guide for exact targeted evidence and limitations.

## Muse shared skill delivery

Muse now uses the existing shared skill index/referenced-content helpers for scoped instruction delivery, plus the public native skill list/typed-input protocol for the existing slash flow. Shared `$name` and native `/selector` remain distinct; native wins slash collisions and a shared-only slash selects instructions. Private Clay skills stay in private/bundled roots, without native registration or global import/activation. The common `skillOptions` scope is bound to exact live session/query/owner authority; unscoped, title/no-skills and foreign queries do not discover/read personal skills. Catalog refresh is session-only. See [MUSE_YOKE_CONTRACTS.md](MUSE_YOKE_CONTRACTS.md) for behavior and limits.

Guarded verification after the extension: **876 tests across 68 files passed**, zero failures/cancellations/skips, exit 0 (`/tmp/clay-muse-skills-final.tap`). This retains the accepted 848 tests and adds 28 scoped skill tests. No UI layout or formal interface redesign was added.
