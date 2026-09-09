# Module Map

> Where to put new code. Read this before adding features or message handlers.

---

## Architecture

`project.js` is a thin coordinator. It wires modules together and dispatches messages. All logic lives in dedicated modules following the `attachXxx(ctx)` pattern.

### Rules

1. **Never add inline logic to project.js handleMessage.** Find the right module and add it there.
2. **500 line limit per module.** If a module grows past 500 lines, split it.
3. **All new modules use the `attachXxx(ctx)` pattern.** Accept dependencies via ctx, return a public API object.
4. **Mutable state uses getters/setters in ctx.** Never capture a primitive that might change later.

---

## Server-side Modules (lib/)

### project.js (thin coordinator, ~1,200 lines)

Wires all modules, sets up session manager and SDK bridge, dispatches messages.

### Message Handler Modules

| Module | Message types | Concern |
|--------|--------------|---------|
| `project-knowledge.js` | `knowledge_list`, `knowledge_read`, `knowledge_save`, `knowledge_delete`, `knowledge_promote`, `knowledge_depromote` | Knowledge file CRUD for mates and projects |
| `project-sessions.js` | `new_session`, `switch_session`, `delete_session`, `rename_session`, `resume_session`, `fork_session`, `rewind_*`, `permission_response`, `elicitation_response`, `set_model`, `set_effort`, `set_thinking`, `set_betas`, `set_*_mode`, `browse_dir`, `add_project`, `create_project`, `clone_project`, `create_worktree`, `remove_project*`, `schedule_move`, `reorder_projects`, `set_project_title`, `set_project_icon`, `get_daemon_config`, `set_pin`, `set_keep_awake`, `set_auto_continue`, `set_image_retention`, `shutdown_server`, `restart_server`, `process_stats`, `stop`, `stop_task`, `kill_process`, `set_update_channel`, `check_update`, `update_now`, `ask_user_response`, `input_sync`, `cursor_*`, `text_select`, `push_subscribe`, `load_more_history`, `search_sessions`, `search_session_content`, `list_cli_sessions`, `set_session_visibility`, `transfer_project_owner`, `set_mate_dm` | Session lifecycle, config, project management, daemon settings, permissions, updates |
| `project-filesystem.js` | `fs_list`, `fs_read`, `fs_write`, `fs_watch`, `fs_unwatch`, `fs_file_history`, `fs_git_diff`, `fs_file_at`, `get_project_env`, `set_project_env`, `read_global_claude_md`, `write_global_claude_md`, `get_shared_env`, `set_shared_env` | File browser, file history, project env/settings |
| `project-user-message.js` | `message`, `note_*`, `term_*`, `context_sources_save`, `browser_tab_list`, `extension_result`, `loop_*` (delegation), `schedule_*`, `send_scheduled_now`, `cancel_scheduled_message` | User message dispatch, sticky notes, terminals, context sources, browser extension |
| `project-message-delivery.js` | (called from `project-user-message.js`) | Idempotent client message identifiers, persisted replay deduplication, and delivery acknowledgements |
| `project-shell-command.js` | `shell_command` | One-shot composer shell execution and pending agent context capture |
| `project-loop.js` | `loop_start`, `loop_stop`, `ralph_wizard_complete`, `ralph_wizard_cancel`, `ralph_cancel_crafting`, `ralph_preview_files`, `loop_registry_*`, `schedule_create`, `hub_schedules_list`, `delete_loop_group` | Loop/Ralph engine, loop registry, scheduling |
| `project-notifications.js` | `notification_mark_read`, `notification_mark_all_read`, `notification_delete`, `notification_clear_all` | Notification center persistence and CRUD |
| `whats-new.js` + `whats-new-content.js` | `whats_new_state` (s2c, pushed from `project-connection.js`), `whats_new_seen` (c2s, handled in `project-sessions.js`) | What's New modal. `whats-new-content.js` is pure data (entries array). `whats-new.js` joins content with per-user seen ids. Client viewer (`lib/public/modules/whats-new.js`) is content-agnostic; add a new modal by appending to the content file only. |
| `project-debate.js` + `home-debate-tool-policy.js` + `debate-model-selection.js` | (called from project.js) `debate_start`, `debate_stop`, `debate_comment`, `debate_conclude_response`, `debate_confirm_brief`, `debate_hand_raise`, `debate_user_floor_response` | Multi-agent debate engine, moderator-enforced non-mutating tool policy, and validated per-participant model overrides |
| `project-mate-creation-proposal.js` + `mate-creation-mcp-server.js` | Query-bound `propose_mate` and exact Home approval | Clay-led Mate interview proposal lifecycle; creates nothing before approval |
| `project-mate-interaction.js` | (called from project.js) `mention`, `mention_stop` | @mention handling, DM digests |
| `project-user-mention.js` | (called from project.js) `user_mention` | User-to-user @mention side conversations within a session. Records to history, broadcasts to other session viewers, queues transcript into `pendingMentionContexts` for the next coding-agent turn, fires alarm-center notification + push for the target user (push only when offline) |
| `project-memory.js` | `memory_list`, `memory_search`, `memory_delete` | Session digest memory |
| `project-logs.js` + `project-logs-mcp-server.js` | `project_logs_list`, `project_log_read`, `project_log_comment`, `project_log_delete` (`project_log_create`/`project_log_update` are retired and always refused); broadcasts `project_log_updated` and `project_log_comment_reviewed` | Project Logs: user-bound WS surface and the session-bound `clay-logs` MCP server. **Canonical entries are created and revised only by Project Driver sessions**; connected humans read and append attributed comments, which are proposals the Driver reviews (`list_log_feedback`, `review_log_comment`) rather than automatic changes. A completed review broadcasts bounded identifiers so an open Logbook refreshes the response immediately, including clarification and decline actions that create no canonical revision. Project owners may delete entries through the human UI; shared members cannot. The system prompt carries only a pending count, never comment bodies. The ledger is a continuous task-handoff record, not an importance filter: every concrete user instruction that changes, diagnoses, designs, or verifies project state gets one coherent entry recording the request and constraints, result or discovery, affected area, verification, current status, and next action when unfinished. Longer work revises that same entry at meaningful milestones rather than producing turn-by-turn narration. Guidance also makes capturing durable **user** learning moments a default: a conceptual question the user engages with, or a vague user description the Driver gives a precise name, is recorded under the project-local `learning` category. Driver learning, repository discoveries, engineering lessons, and investigation outcomes must use their actual record category instead. `ATTENTION_CONTRACT` states the Sticky Notes boundary: notes are the transient attention layer and are closed once resolved, Logs are the permanent versioned record. A Driver that opens a note for a concrete defect it discovered and left unresolved must also create or update a Log entry, put that entry's opaque `log:` ref in the note, and on resolution revise the same entry with remediation/verification/outcome before **closing** the note (closing is reversible and never deletes it). This is Driver-only guidance and never note content: creating a note does not mutate the ledger, because people and authority-less Mates write notes too. Authoritative builtin Clay gets read-only cross-project tools; ordinary Mates get none. Scope and identity are always bound server-side, never read from the message |
| `project-log-feedback-delivery.js` | (called from `project-logs.js`) | Immediate Project Log comment delivery. An idle authoring Driver is resumed directly; when that Driver is busy, an isolated hidden one-turn reviewer handles the feedback concurrently so it does not wait behind unrelated chat work. The exact created session is used as a fallback after a temporary reviewer becomes the latest canonical author; the durable pending-feedback queue remains the fallback when neither authoring session is live |
| `project-mcp.js` | `mcp_servers_available`, `mcp_tool_result`, `mcp_tool_error`, `mcp_toggle_server` | Remote MCP server bridge via Chrome Extension |
| `project-vendor-login.js` | `vendor_login_start`, `vendor_login_cancel`, `vendor_login_state_request` | Vendor `auth_required` recovery. One login terminal per vendor per project (server-tracked), success detection on PTY output, adapter restart so the new credentials are read, `auth_refreshed` broadcast, terminal cleanup |

### Infrastructure Modules

| Module | Concern |
|--------|---------|
| `notes.js` + `notes-lifecycle.js` | Sticky Note storage and its reversible lifecycle. A note is `open` or `closed`; completing one **closes** it, recording `closedAt` and a server-derived `closedBy` actor, and never deletes it. Legacy notes project as open, except the older `hidden: true` flag which already meant the same thing and projects as closed with no invented timestamp. Projection runs on load, so reading rewrites nothing. `remove()` is retained for maintenance and is deliberately unreachable from any WebSocket message, MCP tool, or UI control |
| `project-connection.js` | WebSocket connection setup, initial state sync, session restore, presence |
| `project-http.js` | All HTTP routes: image serving, file upload, push, skills, git status, info |
| `project-image.js` | `hydrateImageRefs`, `saveImageFile`, image directory setup |
| `project-file-watch.js` | File and directory fs.watch wrappers |
| `project-session-spawn.js` | Agent-driven sibling session creation, safety policy, and concurrency queue |
| `project-models.js` | Vendor model discovery, loading/error responses, model matching, and selection acknowledgements |
| `session-title-policy.js` | Shared session-title lifecycle: chooses an immediate provisional label from the recorded visible user message rather than an internal transport prompt, repairs legacy global-search boilerplate titles from that history, and schedules semantic title generation after the first Home exchange or the normal project-session threshold. Provisional labels never masquerade as generated titles, so the generated title can replace them |
| `session-provenance.js` | Durable Driver/Split Worker creation provenance. Assigns opaque per-session origin IDs, records the originating Driver and monotonic Worker generation at pair-factory creation, restores legacy metadata without guessing from titles or split state, and produces owner-safe hierarchy projections. Missing, deleted, inaccessible, corrupt, or ambiguous parents leave a session classified as an orphaned Worker rather than promoting it to Driver |
| `workspace-query-service.js` + `project-workspace-query.js` + `workspace-query-mcp-server.js` | Exact-owner workspace/session read projections, query-bound Mate MCP tools, stable opaque session references, and Clay-only global search capability |
| `workspace-query-access.js` | Authoritative project access for workspace queries. Resolves visibility, owner, and allowedUsers from `onGetProjectAccess(status.slug)` rather than `getStatus()`, re-reads the record on every query so revocations apply immediately, and fails closed on a missing slug, missing/throwing resolver, or error record. Mate ownership comes from the Mate registry because Mate projects are never written to the persisted project list |
| `server-home-clay-session-links.js` | Exact-source, owner-validated navigation for opaque session and Project Log references rendered in Clay responses |
| `server-home-capsule-creation.js` | Validates bounded Capsule creation intents and builds the approval-preserving Mate conversation context |
| `workspace-assignment-service.js` + `project-delegated-session.js` + `project-delegated-follow-up.js` | Durable per-user assignment proposals, exact-session approval routing, private model-resolved delegated sessions, and strictly eligible existing-session follow-ups |
| `tool-ui-spec.js` + `tool-ui-spec-advanced.js` | Canonical safe Capsule declarative vocabulary, bounded condition/dynamic-value validation, field and collection constraints |
| `capsule-display-floor.js` | The mandatory declarative floor element of a Capsule's Display set: registration and Mate-catalog gates that always validate the tree itself (see docs/guides/CAPSULE_DISPLAY.md) |
| `capsule-server-runtimes.js` | Trusted server-runtime Logic registry for shipped Capsules; per-call runtime creation over the Capsule datastore |
| `capsule-pig-logic.js` | Deterministic shipped-Capsule Logic: seat resolution, rule enforcement, persisted monotonic event clock, `{state, event}` act contract |
| `capsule-frame-server.js` | Isolated separate-origin host for opt-in rich Display frames: one-time token URLs, nonce-only no-network frame CSP, in-frame postMessage bridge |
| `capsule-mate-turn.js` + `project-capsule-turn.js` | The Capsule engagement round-trip: Logic declares `event.engage` (turn/start), the game-agnostic bridge delivers it to the opponent Mate (last Mate that acted, host Mate as fallback) in one persistent per-game session via `deliverCapsuleTurn`, and an explicit start navigates the home board into that session |
| `public/modules/tool-renderer.js` + `tool-renderer-advanced.js` + `tool-renderer-chart.js` + `tool-ui-evaluator.js` | Host-rendered Capsule controls, accessible advanced primitives, truthful fixed chart geometry, safe state evaluation, and defensive collection normalization |
| `project-session-pair.js` | **Coordinator** for the visible Driver/Split Worker pair. Owns delegation (`send_to_partner`), `read_partner`, interrupt/close, the delegated-result push-back, and the shared `resumeDriverWithMessage` / `requestDetach` used by both the push-back and permission routing. `groupAndPartner` requires **exact live session object identity** (`sm.sessions.get(caller.localId) === caller`) so a captured stale handler cannot drive a pair. Mounts the pair tools only for the Driver, and only when it is eligible; a plain side-by-side split (no `pair` roles) keeps the original four tools and no lifecycle tools. Delegates creation, lifecycle and prompt text to the modules below — add new pair behavior there, not here |
| `session-driver-eligibility.js` + `session-driver-orchestration.js` | Separate structural Driver capability from proactive orchestration judgment. Every installed project-chat model may structurally drive, but Worker-creation guidance is injected only for GPT-6/Sol-class Codex models and Fable/Opus-class Claude models. Surfaces that cannot host pair controls and sessions durably created as Split Workers are excluded; dissolution never promotes a Worker into a Driver |
| `project-pair-lifecycle.js` | Worker management internals: bounded `partner_status` (context tokens and capacity ratio from `session.lastContextUsage` else the last `result` usage, activity, continuity, replace-safety — never a transcript), transactional replacement, and the per-Driver generation/evaluation ledger (`record_partner_evaluation`, bounded enum, in-memory on the live Driver session). The Driver-facing `replace_partner` first posts the user-controlled configuration card through `project-worker-proposal.js`; only acceptance reaches this module. Preflight runs before any interrupt/cancel/dissolve, generation closure and evaluation happen only after the new Worker exists, and a late group-write failure rolls the pair back. Re-checks exact live session identity, structural capability, owner and live pair on every call |
| `session-pair-turn-control.js` | Server-owned Split Worker retry safety. A human Stop establishes a cancellation barrier that blocks send/create/replace and internal Driver wakeups until the next ordinary human Driver message. Per-turn creation/replacement budgets prevent generation storms, failed reservations roll back, and optional operation ids deduplicate replayed lifecycle calls |
| `session-pair-factory.js` | Pair creation for explicit UI and accepted Driver proposal flows. **Validates everything before creating anything**, so a rejection leaves no orphan session: Worker runtime first, then the existing Driver's structural capability. Any installed, available model may be the Driver. `preflightRuntime` / `preflightWorkerForDriver` are side-effect free so a caller about to destroy something can check first. An explicit model must match the vendor's populated catalog via `modelEntryMatches`; an unpopulated catalog fails closed rather than trusting caller text. Ownership comes from the connection or the Driver session, never the message |
| `session-pair-mcp-server.js` | SDK-free pair tool definitions. The unpaired Driver receives `propose_worker` instead; an existing pair receives the base follow-up set (`send_to_partner`, `read_partner`, `interrupt_partner`, `close_partner`), while `options.lifecycle` adds `partner_status`, the replacement-proposal surface `replace_partner`, and `record_partner_evaluation` |
| `session-pair-prompts.js` | Pure Driver-facing prompt text. Keeps paired-session management guidance separate from high-tier delegation judgment. GPT-6/Sol-class Codex and Fable/Opus-class Claude Drivers receive concrete delegation triggers (multi-module, cross-boundary, migration, or independently executable work); every already-paired Driver still receives the operational safety contract. Edit prose here, not in the coordinator |
| `project-worker-proposal.js` | Split Worker creation and replacement runtime decisions for every structurally eligible Driver. The Driver must provide a concise rationale for its recommended vendor/model/effort. Every proposal is recorded and rendered as a configuration card before mutation. With full access off, the card stays pending for explicit user control; with `bypassPermissions`/skip-permissions on, only the exact server-confirmed recommendation may auto-accept, and the disabled card remains visible as an audit trail. Auto and manual acceptance share the same exact-session/owner/pair/stale checks, factory preflight, replacement transaction, rollback, and one-time delegation path; forged or unavailable values fail closed |
| `project-worker-permission.js` | Split Worker permission routing. An ordinary provider prompt raised inside a Worker is decided by its **exact paired Driver** via `respond_to_worker_permission`, not shown in the Worker pane. Sits below every auto-decision in `handleCanUseTool`, so skip permissions (`bypassPermissions`), the whitelist, `allowedTools` and loop/debate policy still resolve first. `USER_INPUT_TOOLS` (`AskUserQuestion`) stays with the human because it is input, not authorization; plan-mode tools are approvals and route to the Driver. An approval answers one call and never writes `allowedTools` or a permission mode. Fails closed on stop/disconnect/pair change; emits no WebSocket frame |
| `session-spawn-mcp-server.js` | SDK-free `clay-sessions` MCP tool definitions for spawning and checking sessions |
| `session-handoff-mcp-server.js` | SDK-free `clay-handoff` MCP tool definition for reading a session's handoff source chain |
| `project-session-document.js` + `session-document-mcp-server.js` | Session-bound `clay-documents` MCP signal that snapshots and presents explicit Markdown editing work |
| `sdk-bridge.js` | SDK bridge coordinator: createSDKBridge factory, worker lifecycle, query stream, tool permissions, mention sessions. Dynamic-tool calls resolve the current live session definition first and fall back to the query snapshot only for query-bound tools; this keeps Codex's persisted resume catalog aligned with Split Worker handlers after pair-state transitions |
| `sdk-skill-discovery.js` | Skill directory scanning, shell segment splitting, SDK/filesystem skill merging |
| `safe-bash-commands.js` | **Single source of truth** for auto-approved bash commands. Consumed by sdk-bridge.js (`isSafeBashSegment`) and claude-hook-installer.js (`buildClayBashAllowPatterns`) - do not duplicate command lists elsewhere |
| `sdk-bridge.js` → `checkToolWhitelist` | Where a tool becomes auto-approved. The non-mutating `propose_worker` call, pair follow-up/lifecycle tools, and `respond_to_worker_permission` are allowed here so provider authorization never replaces or duplicates the separate human runtime-selection card. Reversible Sticky Note operations are also allowed under the exact `mcp__clay-notes__` namespace; their session-bound handlers still enforce ownership and lifecycle rules. Each handler re-checks identity, eligibility, owner and live pair as applicable. Accept only name forms the bridge can genuinely emit and bind namespace checks exactly so another server cannot borrow a safe tool name. `spawn_sessions` is deliberately excluded. When adding an entry, add exact names rather than a permissive suffix match |
| `sdk-message-queue.js` | Async iterable message queue for streaming input to SDK |
| `sdk-message-processor.js` | SDK stream event processing (message_start, content_block_*), sub-agent message routing |
| `codex-defaults.js` | Codex-specific default values (sandbox, approval, web search). **Single source of truth** - do not duplicate elsewhere |
| `kiro-defaults.js` | Kiro-specific default values (agent/mode). **Single source of truth** - do not duplicate elsewhere |
| `mates.js` | Mate CRUD, builtin mate management, atomic section enforcement, migration |
| `mates-prompts.js` | System section enforcers (team, session memory, sticky notes, project registry, debate), marker constants |
| `mates-knowledge.js` | Common knowledge registry (promote/depromote, cross-mate file sharing) |
| `mates-identity.js` | Identity extraction, backup/restore, change tracking, primary capabilities |
| `mate-ready-creation.js` | Validated ready-Mate finalization | Applies a completed interview identity atomically and removes partial creations on failure |
| `users.js` | User CRUD, invites, profile/PIN update, storage, Linux user integration |
| `users-auth.js` | Authentication, PIN hashing, auth tokens, multi-user mode, setup codes |
| `users-permissions.js` | RBAC permissions, project/session access control |
| `users-preferences.js` | DM favorites/hidden, auto-continue, chat layout, deleted builtin keys, mate onboarding |
| `users-experimental-preferences.js` | Per-user opt-ins for experimental features, including the default-off Capsules gate |
| `server-experimental-settings.js` | REST persistence for experimental per-user feature opt-ins |
| `daemon-sync.js` | Shared 10-second daemon synchronization loop and non-overlapping task registry |
| `daemon-projects.js` | Worktree tracking (scan, rescan, cleanup), removed project filtering |
| `knowledge-record-store.js` | **Single append-only backend** for Clay Knowledge. Scope-addressed JSONL under `{CONFIG_DIR}/knowledge/`, never inside a user repo. Incremental torn-write-tolerant loading, single-syscall appends. Every Knowledge surface is a projection over this, not its own store |
| `project-log-context.js` + `project-logs-context-state.js` + `project-logs-root.js` | Stable project knowledge identities, per-worktree change-set identities, and append-only active/archived/merged lifecycle state. Existing projects freeze their path-derived scope so old `log:` refs remain valid; new projects receive path-independent IDs. Worktree markers live in Git administration data so they survive daemon restarts and branch renames |
| `worktree.js` + `daemon-projects.js` + `git-cli.js` | Git worktree creation, discovery, registration, and removal. In OS-user mode every Git command and worktree metadata write runs as the parent project's provisioned owner, with the authenticated requester used only as a fallback for ownerless legacy projects; never bypass Git ownership checks with `safe.directory` |
| `project-logs-store.js` | Project Logs projection: stable opaque `log:` refs, revision chains, tombstones, author/blame, append-only comments, bounded list/search/read/history, and worktree change-set provenance. Comments never advance the revision count. `categories()` derives the project's live vocabulary from its own non-deleted entries, so a revision or deletion changes the vocabulary without rewriting history and a shared project shares one vocabulary |
| `project-logs-snapshot.js` | Canonical snapshots and revision reconstruction. Every NEW canonical edit stores a complete immutable snapshot; legacy partial records are never rewritten and are reconstructed by folding forward, so history is deterministic across the boundary |
| `project-logs-comments.js` | Comment and review projection. A user comment is a revision proposal that starts `pending`; append-only reviews fold onto it as `incorporated`, `clarification-needed`, or `declined`. A comment written before reviews existed projects as pending |
| `project-logs-versioning.js` | Project Driver review and revision control: `review` (incorporate writes exactly one record that both resolves the comment and carries the new snapshot; clarify/decline write no revision), `revert` (appends a new full-snapshot revision, never erases later history, refuses a no-op or a deleted entry), and `readRevision` |
| `project-logs-schema.js` | Project Logs vocabulary and validation. **Category is a bounded project-local label, never a global enum**: `normalizeCategory` reduces free text to a lowercase hyphen-separated label of letters and digits in any script (Hangul, CJK, Cyrillic and accented Latin included), bounded at 32 code points, and refuses empty, path-shaped, or otherwise unusable input. A supplied malformed filter is an error, never a silently dropped one. `safeCategory` is the non-throwing form used only when reading a possibly corrupt stored record. Seed categories are tool guidance only. Priority stays the stable `normal`/`important`/`urgent` enum. Also holds the deterministic summary fallback and the shared text/shape normalizers |
| `knowledge-search.js` | **Shared BM25 adapter.** Thin wrapper over `session-search.js`'s `buildIndex`/`searchIndex` and its CJK-bigram tokenizer. Field weighting is controlled repetition before indexing. Long records are segmented into overlapping bounded documents (short fields anchor every segment) and collapsed back to one result per item by best segment score, so tail matches are never lost to truncation. Coverage is bounded at `MAX_INDEXED_CHARS` per record and reported via `coverage()`, so an incompletely indexed record is stated rather than implied. Every Knowledge surface ranks through this; do not add a second ranker or embeddings. Also owns `compareIds()`, the locale-independent UTF-16 code-unit comparator every Knowledge surface must use to break score/recency ties on opaque base64url ids and refs; `localeCompare` orders `-` and `_` by ICU collation and is not deterministic across environments |
| `mate-knowledge-service.js` + `mate-knowledge-mcp-server.js` + `project-mate-knowledge.js` | Session-bound `clay-knowledge` MCP surface. An ordinary Mate gets `list_knowledge`/`search_knowledge`/`read_knowledge` over its own scope with no mateId/owner/scope argument; authoritative builtin Clay gets same-user cross-Mate `list_mate_knowledge`/`search_mate_knowledge`/`read_mate_knowledge`. Reads the synchronized Knowledge records, excludes chunks and tombstones, hash-verifies reassembly, and refuses partial content. Non-Mate projects get nothing here |
| `project-logs-query.js` | Project Logs filtering (exact project-local category, priority enum, tag), BM25 ranking with summary weighting, snippets, pagination, and the ledger row projection, extracted from `project-logs-store.js` to keep it under the size limit |
| `knowledge-import.js` | Import-keyed projection over the record backend. Stable import keys make imports idempotent; tombstones handle logical removal; oversized sources are stored as content-addressed chunks and reassembled exactly (never truncated). Index is maintained incrementally so a no-op run stays cheap |
| `mate-knowledge-sync.js` | **Single source-to-record mapping** for Mate Knowledge, used by both the startup migration and the live write-through bridge. `syncMateSource`/`reconcileSource` reconcile one legacy source: create, revise, revive, or tombstone. Journal reconciliation tombstones lines removed from the legacy file. Identity files and `sticky-notes.md` are never mirrored. Called from `project-knowledge.js`, `project-mate-interaction.js`, and `project-memory.js` after their legacy writes |
| `mate-knowledge-migration.js` | Discovery, run lock, and versioned state for the automatic upgrade import; delegates source work to `mate-knowledge-sync.js`. Non-destructive, torn-input tolerant, per-user isolated scopes. A lock held by a live PID is never stolen. Called once from `daemon.js` startup |
| `project-logs-service.js` | Project Logs authorization. Binds from exact session object identity, `ws._clayUser`, or the confirmed builtin Clay Mate registry entry; fails closed on an unattributed multi-user session; re-authorizes and re-derives identity on every call. A session binding may write canonically; a user binding may only comment; Clay may only read |
| `ws-schema.js` | WebSocket message type registry (474 message types, informational) |

### YOKE Adapters (lib/yoke/)

YOKE is the vendor-agnostic interface layer. Each adapter implements the same contract (init, createQuery, etc.) for a specific agent runtime.

| Module | Concern |
|--------|---------|
| `yoke/index.js` | Adapter factory, wraps createQuery with project instructions |
| `yoke/interface.js` | YOKE interface contract definition, plus vendor-neutral shared constants (`INITIALIZE_TIMEOUT_MS`) |
| `yoke/adapters/claude.js` | Claude adapter using `@anthropic-ai/claude-agent-sdk`. In-process + worker (OS user isolation) paths |
| `yoke/adapters/codex.js` | Codex adapter using `codex app-server` JSON-RPC protocol. Handles approval events, skill injection, MCP bridge config |
| `yoke/codex-app-server.js` | Codex `app-server` child process manager. JSON-RPC 2.0 over stdin/stdout, request ID tracking, event routing |
| `yoke/adapters/acp.js` | Shared default YOKE adapter for ACP agents. Vendor drivers may augment or replace lifecycle behavior so ACP never limits the YOKE contract |
| `yoke/adapters/antigravity.js` | Antigravity CLI integration using Google's official bidirectional stream-JSON protocol for sessions, models, effort, tools, results, and usage |
| `yoke/acp-agent-profiles.js` + `yoke/acp-driver-runtime.js` | OpenCode, Kimi Code, Grok Build, GitHub Copilot CLI, Qwen Code, and Junie CLI process metadata plus composable vendor hooks for initialization, sessions, permissions, events, results, and optional YOKE methods |
| `yoke/acp-query-handle.js` + `yoke/acp-event-normalizer.js` | Shared ACP session lifecycle, permission handling, and YOKE event normalization |
| `yoke/adapters/kiro.js` | Kiro adapter using `kiro-cli acp` (Agent Client Protocol). Dynamic model catalog, event flattening (session/update), permission routing, session resume |
| `yoke/acp-process-manager.js` | Vendor-neutral ACP child process manager. JSON-RPC 2.0 over stdin/stdout, request ID tracking, session-aware event routing |
| `yoke/kiro-acp-server.js` | Thin Kiro ACP profile. Binary discovery, Kiro arguments, and auth-error detection |
| `yoke/mcp-bridge-server.js` | Stdio MCP server spawned by Codex. Proxies tool list/call to Clay via HTTP at `/api/mcp-bridge` |

**When adding a new vendor**: use the shared ACP defaults when the runtime supports ACP, then keep special behavior in its driver hooks. If the runtime needs deeper semantics, retain a dedicated YOKE adapter while sharing only the ACP process manager, as Kiro does. For a non-ACP runtime, implement the YOKE interface and register it in `yoke/index.js`.

**For Codex-specific patterns and gotchas**: see [CODEX-INTEGRATION.md](./CODEX-INTEGRATION.md).

**For Kiro-specific patterns and gotchas**: see [KIRO-INTEGRATION.md](./KIRO-INTEGRATION.md).

### Server Modules (lib/server-*.js)

server.js is a thin router. It wires all server modules, sets up HTTP/WS, and dispatches requests.

| Module | Routes | Concern |
|--------|--------|---------|
| `server-auth.js` | `/auth`, `/auth/setup`, `/auth/login`, `/auth/request-otp`, `/auth/verify-otp`, `/auth/register`, `/auth/logout`, `/invite/*`, `/recover/*` | PIN auth, multi-user login, OTP, invite registration, admin recovery, rate limiting |
| `server-admin.js` | `/api/admin/users*`, `/api/admin/invites*`, `/api/admin/smtp*`, `/api/admin/projects/*/visibility`, `/api/admin/projects/*/owner`, `/api/admin/projects/*/users`, `/api/admin/projects/*/access` | User CRUD, permissions, invites, SMTP config, project access control |
| `server-skills.js` | `/api/skills`, `/api/skills/search`, `/api/skills/detail` | Skills proxy cache, leaderboard, search, detail page scraping |
| `server-settings.js` | `/api/profile`, `/api/avatar/*`, `/api/mate-avatar/*`, `/api/user/pin`, `/api/user/auto-continue`, `/api/user/chat-layout`, `/api/user/mate-onboarded` | User profile, avatars, user preferences |
| `server-palette.js` | `/api/palette/search` | Cross-project session search (recent + BM25 ranked) |
| `server-dm.js` | WS: `dm_list`, `dm_open`, `dm_typing`, `dm_send`, `dm_add_favorite`, `dm_remove_favorite` | Cross-project DM messaging, typing indicators, push notifications |
| `server-mates.js` | WS: `mate_create`, `mate_list`, `mate_delete`, `mate_update`, `mate_readd_builtin`, `mate_list_available_builtins` | Mate CRUD, builtin mate management, team section enforcement |
| `server-home-mate-creation.js` | WS: `home_mate_creation_*` | Server-seeded exact Clay interview session and correlated question/proposal relay |

### Where to add a new server HTTP endpoint

1. Identify which concern it belongs to (auth? admin? skills? settings?)
2. Add the handler in the matching module's `handleRequest` function
3. If no module fits, add it directly in `server.js` appHandler or create a new `server-*.js` module

### Where to add a new message type

1. Identify which concern it belongs to (session mgmt? filesystem? loop? etc.)
2. Add the handler in the matching module's `handleXxxMessage` function
3. If no module fits, create a new one following the `attachXxx(ctx)` pattern
4. Wire it in project.js with a single `if (module.handleXxxMessage(ws, msg)) return;` line

### Where to add a new HTTP endpoint

Add it in `project-http.js` inside the `handleHTTP` function.

---

## Client-side Modules (lib/public/modules/)

### app.js (bootstrap coordinator, ~1,100 lines)

Bootstraps UI, initializes store, wires remaining Tier 3 modules. All business logic lives in modules. See [NO-GOD-OBJECTS.md](./NO-GOD-OBJECTS.md) for architectural principles.

| Module | Concern |
|--------|---------|
| `app-connection.js` | WebSocket creation, reconnect with exponential backoff, connection status UI, disconnect/restore notifications |
| `app-messages.js` | WebSocket message router (`processMessage`). Dispatches all incoming message types to appropriate handlers |
| `app-dm.js` | DM mode (open/enter/exit), mate project switching, mate onboarding, DM message rendering, typing indicators |
| `app-home-hub.js` | Home hub rendering, weather, tip rotation, upcoming schedules, project summary |
| `home-chat-scroll.js` | User-intent-aware Home transcript following, scroll preservation, and new-activity affordance |
| `home-debate-models.js` | Safe per-participant model selectors and override collection for Home debate approval |
| `home-mate-creation.js` | Clay-led Mate creation proposal card, exact response routing, and restored status |
| `home-capsule-creation-intent.js` | Resolves the server-restored selected Mate and hands Workbench Capsule descriptions into an exact Home conversation |
| `home-capsule-library.js` | Create-first Workbench library surface and installed Capsule inventory |
| `home-tool-frame.js` | Host side of the sandboxed rich Display frame: frame URL request, allow-scripts iframe mount, bounded act relay into the shared pipeline, floor fallback |
| `search-clay-chat.js` | Query-bound compact Clay conversation inside global search, with exact-session expansion to Home |
| `app-rate-limit.js` | Rate limit UI, countdown timers, scheduled message bubbles, fast mode indicator |
| `app-cursors.js` | Remote cursor presence, text selection sharing, cursor toggle UI |
| `app-rendering.js` | Message rendering, streaming, scroll management, pre-thinking dots, suggestion chips, system messages |
| `app-projects.js` + `project-removal-target.js` | Project list, switching, add/remove project modals, update available pill, topbar presence; pure nearest-project destination selection after active-project removal |
| `project-activation.js` | Pure Home return-target selection and server-confirmed project/session activation checks; route intent or project info alone never counts as a restored project |
| `app-panels.js` | Config chip (model/mode/effort/thinking/beta), usage panel, status panel, context panel, context popover |
| `model-picker.js` | Vendor model loading state, request correlation, retry/error UI, and acknowledged model selection |
| `filebrowser-tabs.js` | Global document-viewer tab lifecycle, focus, and close behavior |
| `worker-proposal.js` + `worker-proposal-state.js` | Inline Split Worker creation/replacement configuration and audit card plus its pure runtime-selection projection. Resolved cards prefer persisted `selectedVendor`/`selectedModel`/`selectedEffort`; recommendation fields seed only cards with no selection. The card renders the Driver-authored recommendation rationale and decision source. Pending cards send one correlated accept/decline response; auto-accepted full-access cards stay visible with disabled controls and an explicit audit label. Historical cards without rationale and legacy `autoApproved` updates still render |
| `app-loop-ui.js` | Ralph Loop UI: bars, banners, preview modal, execution modal |
| `app-loop-wizard.js` | Ralph Loop wizard: step navigation, mode/authorship selection, data collection |
| `app-notifications.js` | Notification center panel, badge, rendering, click-to-navigate |
| `vendor-login.js` | Client half of the vendor login flow: requests the server-owned login terminal, opens/re-attaches the modal, login banners, split-pane forwarding. `app-notifications.js` depends on this module, never the reverse |
| `sticky-notes.js` + `sticky-notes-shared.js` + `sticky-notes-card.js` + `sticky-notes-editor.js` + `sticky-notes-browser.js` | Floating note canvas and the bounded **right workbench** browser. Layered so every module stays under the size limit and the graph is acyclic: `shared` is a dependency-neutral leaf (send, geometry clamps, debounce timers, `isClosedNote`, `syncTitle`) → `editor` (format toolbar, contenteditable) → `card` (one note's markup, drag/resize, header controls) → `sticky-notes` (notes map, visibility, badges, WS handlers); `browser` depends on `sticky-notes` and `shared` only. All socket traffic goes through the single `send()` in `shared`. The canvas keeps the floating cards; the browser is the index/viewer, split into **Open** and **Closed** tabs with Close/Reopen and no destructive control at all. It mounts in `#main-panels` beside the conversation, supports the shared optional wide and `panel-fullscreen` states, defaults to the right pane, and is a full-viewport overlay under 1024px. Opening it closes the other right tools and vice versa. Badges count open notes, not all history. The browser registers a refresh hook rather than being imported back, so the two modules never form a cycle |
| `app-debate-ui.js` | Debate sticky banner, floor/conclude/ended modes, bottom bar, hand raise |
| `background-tasks-ui.js` | Active background-task indicator and task stop controls |
| `app-skills-install.js` | Skill install dialog, requireSkills, requireClayMateInterview |
| `app-favicon.js` | Dynamic favicon, IO blink, urgent blink, send button mode, activity indicator |
| `app-header.js` | Session rename, session info popover, progressive history loading |
| `app-misc.js` + `paste-modal.js` | Image/confirm modals, force PIN overlay, PWA install, Chrome extension bridge; the paste dialog is a shared leaf with read-only history and editable composer modes |
| `sidebar.js` | Sidebar coordinator: init, open/close, page title, panel switching, collapse/expand, resize handle, dust particles |
| `sidebar-sessions.js` + `session-hierarchy.js` + `sidebar-session-hierarchy.js` | Session list rendering, search/filter, loop groups, inline rename, context menus, presence avatars, countdown timers, CLI session picker, unread badges, and accessible expandable Driver/Worker trees. `session-hierarchy.js` is the pure projection shared by desktop, mobile, and Home; `sidebar-session-hierarchy.js` owns project desktop/mobile hierarchy state and rendering so the legacy sidebar modules retain thin orchestration. Active split membership only marks the current Worker and never determines parentage |
| `sidebar-projects.js` | Project icon strip, context menus, emoji picker, drag-and-drop reorder, worktree modal, project access popover, project rename, project badges |
| `sidebar-mates.js` | User/mate icon strip, DM picker, user/mate context menus, icon strip tooltips, sidebar presence, DM badges, DM user state |
| `sidebar-mobile.js` | Mobile sheet overlays (projects, sessions, mate profile, search, tools, settings), mobile tab bar, drag-to-dismiss, mobile loop groups, mobile session rendering |
| `scheduler.js` | Scheduler coordinator: init, open/close, calendar views (month/week), detail view, crafting mode, sidebar task list, cron utilities |
| `scheduler-config.js` | Schedule create/edit modal, delete dialog, cron builder, recurrence/interval UI, calendar date picker, preview events |
| `scheduler-history.js` | Run history rendering, schedule event message handlers (registry updates, run started/finished, loop scheduled) |
| `project-logs.js` + `project-logs-render.js` | Project Logs ledger in the bounded right workbench pane. One navigation stack: full-pane list, full-pane entry detail, Back preserving query/filter/scroll. `project-logs-render.js` owns markup only (ledger rows, detail, discussion) and never touches the WebSocket. There is no canonical create or edit UI: people read and comment. Logs open from the explicit tool control or an exact rendered `log:` reference; there is no edge reveal, hover preview, or pinned preview state. Canonical updates mark the tool button without opening the pane, and unread state is live-session only |
| `clay-log-links.js` | Converts exact `log:` references in rendered Markdown into accessible Log controls while leaving code, links, buttons, and lookalike identifiers untouched |
| `terminal-toolbar.js` | **Shared** mobile control-key bar (Tab/Ctrl/Esc/arrows/Alt) used by both `terminal.js` (bottom-panel shell) and `session-tui-view.js` (embedded TUI). Owns key sequences + sticky modifiers; callers pass a `send` fn. Do not duplicate the key logic |
| `shell-command.js` | Composer shell-command mode, one-shot result card, and next-message context state |
| `worker-pane-lock.js` | Driver-operated Split Worker surface. For the **configured Worker of a live pair only**, removes the human composer (input, attachments, send, schedule/ask-mate/context) and its permission chrome (skip-permissions pill, config chip), replacing the composer footprint with one non-interactive "Controlled by Driver" status line. Transcript, streaming status, tool/permission progress, scrolling and the stop control all stay. Role comes **only** from `splitGroups` plus the displayed session (the pane's own session inside an iframe), so dissolve, replacement, role swap, session switch and reconnect are all correct with no second copy of the role and nothing in localStorage; an ad-hoc split has no pair roles and keeps its composer. Locked controls get `disabled` + `tabindex="-1"` and the region gets `aria-hidden`, so no focusable dead input is left. This is presentation only — enforcement lives server-side in `project-user-message.js` (refuses an ordinary human send into a configured Worker) and `project-worker-permission.js` (`isDriverOperated`, and `inheritedPermissionMode` for the Driver's live permission mode) |
| `git-panel.js` + `git-placard.js` + `git-agent-sessions.js` | The Git surface. Git has **no tool-palette tile**: a real repository shows an always-visible compact placard under the sidebar tool strip, whose More control opens the same full panel as before. `git-panel.js` is the **single Git data path** — it owns both readings (`/api/git/status` while the panel is open, the cheap `/api/git/summary` otherwise) behind one timer, and hands the placard a projection so the two can never disagree. `git-placard.js` renders only server-derived bounded fields and never a repository path; it stays hidden entirely for non-Git projects, Home/Mate surfaces, and pending detection, so nothing flashes. `git-agent-sessions.js` holds the focused commit/review agent handoffs and the shared Git surface teardown. Do not add a second Git poll or fetch |

---

## Extraction Pattern Reference

```js
// lib/project-example.js
var fs = require("fs");

function attachExample(ctx) {
  var cwd = ctx.cwd;
  var send = ctx.send;

  // Module-private state
  var counter = 0;

  function handleExampleMessage(ws, msg) {
    if (msg.type === "example_increment") {
      counter++;
      send({ type: "example_count", count: counter });
      return true;
    }
    return false; // not handled
  }

  return {
    handleExampleMessage: handleExampleMessage,
  };
}

module.exports = { attachExample: attachExample };
```

---

## See Also

- [STATE_CONVENTIONS.md](./STATE_CONVENTIONS.md) for state management rules
- [CLIENT_MODULE_DEPS.md](./CLIENT_MODULE_DEPS.md) for client-side dependency rules (store.js, ws-ref.js, direct imports)
- [NO-GOD-OBJECTS.md](./NO-GOD-OBJECTS.md) for architectural principles (why and how we keep modules small)
- [MCP-IMPLEMENTATION.md](./MCP-IMPLEMENTATION.md) for MCP server architecture (local + extension-bridged)
- [CODEX-INTEGRATION.md](./CODEX-INTEGRATION.md) for Codex-specific patterns, gotchas, and testing checklist
- [REFACTORING_ROADMAP.md](../roadmaps/completed/REFACTORING_ROADMAP.md) for decomposition history
