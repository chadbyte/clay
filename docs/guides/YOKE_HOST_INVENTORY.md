# Residual non-YOKE provider-reference inventory

Scope: `lib/**/*.js`, excluding `lib/yoke/**` and vendored browser dependencies. The scan includes all ten registered provider names, SDK option namespaces and raw billing token fields, followed by review of equality checks, login commands, config paths and parsers. This is a source-reference inventory, not a claim that every retained name is runtime behavior. Tests and build dependencies necessarily identify providers as fixtures/packages.

Provider configuration, output/protocol parsing and lifecycle implementation converted in this branch are listed in [YOKE_QUERY_CONTRACTS.md](YOKE_QUERY_CONTRACTS.md). The only remaining literal provider-equality decisions in server product code select the deliberate Codex Worker preference; runtime/transport admission consumes semantic contracts. Same-provider comparisons, missing-vendor defaults and managed-directory security exclusions remain product policy.

Each matching source file is listed below with the reason its names remain. First matching line is included to make inspection reproducible. Other references in that file belong to the same categories or are specifically discussed in the interface guide. Literal raw usage fields outside YOKE occur only in explanatory comments; normalization is inside YOKE.

## Product identity, defaults and selection policy

Provider IDs identify the chosen runtime and existing default. Worker preference and high-tier eligibility are deliberate Clay product policy; they do not build provider options or interpret protocols.

| Source | First reference | Reason |
| --- | --- | --- |
| `lib/debate-model-selection.js` | 31 | Retained under the category above. |
| `lib/mate-ready-creation.js` | 44 | Retained under the category above. |
| `lib/mates.js` | 136 | Retained under the category above. |
| `lib/project-mate-interaction.js` | 49 | Retained under the category above. |
| `lib/project-models.js` | 336 | Retained under the category above. |
| `lib/project-worker-proposal.js` | 115 | Retained under the category above. |
| `lib/public/modules/mate-wizard.js` | 9 | Retained under the category above. |
| `lib/public/modules/sidebar-sessions.js` | 154 | Retained under the category above. |
| `lib/public/modules/split-pair-ui.js` | 20 | Retained under the category above. |
| `lib/public/modules/vendor-priority.js` | 1 | Retained under the category above. |
| `lib/server-home-models.js` | 41 | Retained under the category above. |
| `lib/session-driver-orchestration.js` | 7 | Explicit high-tier Driver eligibility and model policy, permitted by task scope. |
| `lib/session-pair-factory.js` | 102 | Retained under the category above. |

## Compatibility storage and public API names

Persisted records, WS setting names, legacy identity files and Clay-owned loop artifacts retain their paths/keys for compatibility. Managed-directory exclusions are product security policy. Provider field interpretation is delegated to YOKE.

| Source | First reference | Reason |
| --- | --- | --- |
| `lib/clay-studio-cert.js` | 30 | Retained under the category above. |
| `lib/config.js` | 33 | Retained under the category above. |
| `lib/mate-identity-file.js` | 19 | Retained under the category above. |
| `lib/mate-knowledge-sync.js` | 15 | Retained under the category above. |
| `lib/mates-prompts.js` | 34 | Retained under the category above. |
| `lib/notes.js` | 79 | Retained under the category above. |
| `lib/project-loop.js` | 57 | Retained under the category above. |
| `lib/project-scheduled-task-execution.js` | 23 | Retained under the category above. |
| `lib/project-scheduled-tasks.js` | 38 | Retained under the category above. |
| `lib/project-session-notes.js` | 128 | Retained under the category above. |
| `lib/project-workspace-operations.js` | 25 | Retained under the category above. |
| `lib/public/app.js` | 99 | Retained under the category above. |
| `lib/public/modules/app-dm.js` | 29 | Retained under the category above. |
| `lib/public/modules/app-messages.js` | 528 | Retained under the category above. |
| `lib/public/modules/user-settings-account.js` | 146 | Retained under the category above. |
| `lib/public/modules/user-settings-editors.js` | 21 | Retained under the category above. |
| `lib/public/modules/user-settings-layout.js` | 45 | Retained under the category above. |
| `lib/public/modules/user-settings-preferences.js` | 30 | Retained under the category above. |
| `lib/scheduled-task-records.js` | 90 | Retained under the category above. |
| `lib/sessions.js` | 37 | Legacy catalog/settings bytes and session defaults remain; YOKE owns marker mapping, transcript grammar and usage projections. |
| `lib/users-preferences.js` | 256 | Retained under the category above. |

## Human rendering and static branding

Names, avatars, links, notification tags, comments and fallback identity labels are human presentation. Runtime control choices, quota/context projections and known commands now come from YOKE descriptions. No provider SDK execution occurs here.

| Source | First reference | Reason |
| --- | --- | --- |
| `lib/pages.js` | 250 | Retained under the category above. |
| `lib/public/modules/app-favicon.js` | 213 | Retained under the category above. |
| `lib/public/modules/app-header.js` | 130 | Resume display command comes from serializable provider metadata; no hardcoded CLI syntax. |
| `lib/public/modules/app-loop-ui.js` | 631 | Retained under the category above. |
| `lib/public/modules/app-message-cards.js` | 34 | Retained under the category above. |
| `lib/public/modules/app-notifications.js` | 128 | Identity defaults; sign-in command comes from provider metadata, with no invented fallback. |
| `lib/public/modules/app-panels.js` | 393 | Retained under the category above. |
| `lib/public/modules/app-rate-limit.js` | 38 | Retained under the category above. |
| `lib/public/modules/app-rendering.js` | 26 | Retained under the category above. |
| `lib/public/modules/app-skills-install.js` | 251 | Retained under the category above. |
| `lib/public/modules/background-tasks-ui.js` | 20 | Retained under the category above. |
| `lib/public/modules/chat-render-runtime.js` | 8 | Retained under the category above. |
| `lib/public/modules/context-sources.js` | 3 | Retained under the category above. |
| `lib/public/modules/filebrowser.js` | 1827 | Retained under the category above. |
| `lib/public/modules/fileicons.js` | 101 | Retained under the category above. |
| `lib/public/modules/generated-images.js` | 1 | Retained under the category above. |
| `lib/public/modules/input.js` | 81 | Retained under the category above. |
| `lib/public/modules/mate-sidebar.js` | 144 | Retained under the category above. |
| `lib/public/modules/mcp-connection-view.js` | 35 | Retained under the category above. |
| `lib/public/modules/mcp-discovery-view.js` | 7 | Retained under the category above. |
| `lib/public/modules/mention.js` | 69 | Retained under the category above. |
| `lib/public/modules/model-picker.js` | 104 | Retained under the category above. |
| `lib/public/modules/notifications.js` | 47 | Retained under the category above. |
| `lib/public/modules/pane-session.js` | 17 | Retained under the category above. |
| `lib/public/modules/playbook.js` | 284 | Retained under the category above. |
| `lib/public/modules/project-chat-identity.js` | 35 | Retained under the category above. |
| `lib/public/modules/scheduler.js` | 755 | Retained under the category above. |
| `lib/public/modules/session-actions.js` | 45 | Retained under the category above. |
| `lib/public/modules/session-create-form.js` | 305 | Retained under the category above. |
| `lib/public/modules/session-tui-view.js` | 3 | Retained under the category above. |
| `lib/public/modules/split-pane-renderer.js` | 48 | Retained under the category above. |
| `lib/public/modules/terminal-prefs.js` | 16 | Retained under the category above. |
| `lib/public/modules/tools.js` | 724 | Tool-card rendering and brand icons; plan-path hints now come from provider metadata. |
| `lib/public/modules/tui-attention.js` | 3 | Retained under the category above. |
| `lib/public/modules/tui-grab.js` | 3 | Historical TUI comments; availability uses sessionModes and unknown providers fail closed. |
| `lib/public/modules/vendor-login.js` | 161 | Retained under the category above. |
| `lib/public/modules/worker-proposal.js` | 264 | Retained under the category above. |
| `lib/public/sw.js` | 110 | Retained under the category above. |
| `lib/speech-catalog.js` | 3 | Retained under the category above. |

## Calls into YOKE or compatibility entrypoints

Common code invokes actual YOKE services, persists compatible fields or uses the default provider identity. Old filenames/exports remain compatibility entrypoints; protocol implementation is under lib/yoke. Host retains owner/review/Stop and exact-target admission.

| Source | First reference | Reason |
| --- | --- | --- |
| `lib/claude-hook-installer.js` | 1 | Retained under the category above. |
| `lib/claude-jsonl-watcher.js` | 1 | Retained under the category above. |
| `lib/codex-defaults.js` | 1 | Retained under the category above. |
| `lib/context-usage.js` | 19 | Retained under the category above. |
| `lib/daemon.js` | 8 | Retained under the category above. |
| `lib/kiro-defaults.js` | 1 | Retained under the category above. |
| `lib/os-users.js` | 471 | Retained under the category above. |
| `lib/project-http.js` | 267 | Retained under the category above. |
| `lib/project-mcp.js` | 155 | Default identity and YOKE transport admission; previous Antigravity equality guard removed. |
| `lib/project-pair-usage.js` | 21 | Retained under the category above. |
| `lib/project-session-runtime-actions.js` | 11 | Retained under the category above. |
| `lib/project-session-spawn.js` | 163 | Retained under the category above. |
| `lib/project-sessions.js` | 234 | Retained under the category above. |
| `lib/safe-bash-commands.js` | 8 | Retained under the category above. |
| `lib/sdk-bridge.js` | 186 | Retained under the category above. |
| `lib/sdk-message-processor.js` | 45 | Retained under the category above. |
| `lib/sdk-response-recovery.js` | 1 | Retained under the category above. |
| `lib/sdk-worker.js` | 2 | Legacy process entrypoint delegates to the real YOKE worker; duplicate protocol removed. |
| `lib/server.js` | 13 | Retained under the category above. |
| `lib/session-hygiene.js` | 8 | Retained under the category above. |
| `lib/session-permission-mode.js` | 11 | Retained under the category above. |

## Generic product services and documentation comments

References are default identity metadata, neutral product prompt fields such as claudeMd, historical comments/tags, directory denylist entries or standard MCP OAuth. Product persistence/rendering/authorization remains outside YOKE; no provider-specific execution/parser branch is retained.

| Source | First reference | Reason |
| --- | --- | --- |
| `lib/background-task-timing.js` | 7 | Retained under the category above. |
| `lib/builtin-mates.js` | 35 | Retained under the category above. |
| `lib/clay-product-control-tools.js` | 48 | Retained under the category above. |
| `lib/clay-product-control.js` | 76 | Retained under the category above. |
| `lib/crisis-safety.js` | 18 | Retained under the category above. |
| `lib/email-mcp-server.js` | 3 | Email business tools remain product-owned; YOKE supplies the real SDK tool-server envelope. |
| `lib/mcp-local.js` | 357 | Retained under the category above. |
| `lib/project-connection.js` | 141 | Retained under the category above. |
| `lib/project-debate.js` | 13 | Retained under the category above. |
| `lib/project-file-history.js` | 72 | Retained under the category above. |
| `lib/project-full-access.js` | 74 | Retained under the category above. |
| `lib/project-mate-chat-control.js` | 15 | Retained under the category above. |
| `lib/project-mate-creation-proposal.js` | 102 | Retained under the category above. |
| `lib/project-memory.js` | 290 | Retained under the category above. |
| `lib/project-notifications.js` | 24 | Retained under the category above. |
| `lib/project-product-control.js` | 52 | Retained under the category above. |
| `lib/project-session-actions.js` | 43 | Retained under the category above. |
| `lib/project-session-delete.js` | 57 | Retained under the category above. |
| `lib/project-session-handoff.js` | 97 | Retained under the category above. |
| `lib/project-session-history-actions.js` | 26 | Retained under the category above. |
| `lib/project-session-pair.js` | 221 | Retained under the category above. |
| `lib/project-user-message.js` | 608 | Retained under the category above. |
| `lib/project-vendor-login.js` | 17 | Retained under the category above. |
| `lib/project.js` | 172 | Retained under the category above. |
| `lib/server-global-ws.js` | 26 | Retained under the category above. |
| `lib/server-home-chat.js` | 508 | Retained under the category above. |
| `lib/server-mates.js` | 36 | Retained under the category above. |
| `lib/server-settings.js` | 603 | Retained under the category above. |
| `lib/session-handoff-context.js` | 85 | Retained under the category above. |
| `lib/terminal-manager.js` | 7 | Retained under the category above. |
| `lib/terminal.js` | 15 | Retained under the category above. |
| `lib/users.js` | 384 | Retained under the category above. |
| `lib/utils.js` | 10 | Retained under the category above. |
| `lib/vendor-login-browser-flow.js` | 20 | Retained under the category above. |
| `lib/vendor-login-browser.js` | 127 | Retained under the category above. |
| `lib/ws-schema.js` | 20 | Retained under the category above. |

Total matching source files: 130. This inventory does not include Muse implementation from its separate worktree. No provider runtime exception remains implemented in a host vendor-name branch; actual provider protocol exceptions are under YOKE.

The `vendor-login-browser.js` comparison with the literal `mcp` distinguishes standard MCP OAuth from provider sign-in; it is not a coding-provider exception. Standard MCP OAuth and remote connection authorization remain product services. Generic same-provider comparisons elsewhere enforce exact current session/model/socket identity and must remain in Clay.

## Risk-focused boundary follow-up

The review checked actual option namespaces, binary selection, provider-equality branches, raw token/auth/quota fields, JSONL consumers and asynchronous fork admission. It found and corrected three functional boundaries: Antigravity's separate discovery/startup resolver plus discovery-only PATH fallback; generic fork fallback selecting Claude's transcript reader; and a raw provider quota alias in the common event processor. See the executable-discovery tests and interface guide for implementation and verification.

`project-session-history-actions.js` now selects the declared `readSessionHistory` implementation via YOKE; `project-session-spawn.js` uses the same service and preserves its injected test reader. A provider lacking that reader refuses a file-backed fork. TUI history/watch/index consumers operate only the existing legacy terminal format; its parsing and paths remain inside YOKE. Common code retains product session effects and identity/revision validation.

Retained comparisons were reviewed for behavior: Worker/model-tier preference is product policy; same-provider comparisons reject stale session/model/quota targets; `mcp` selects the standard OAuth flow rather than a coding-provider protocol. Provider option envelopes, binary validation, auth grammar and recovery implementations remain inside YOKE. This review did not invoke providers, real sign-in, provisioning or process termination.

## Branch change inventory

All tracked modifications and new files in this worktree relative to `9e95b941` are listed below, including the accepted first milestone and follow-up corrections. No commits were created.

```text
docs/guides/YOKE_HOST_INVENTORY.md
docs/guides/YOKE_QUERY_CONTRACTS.md
lib/claude-hook-installer.js
lib/claude-jsonl-watcher.js
lib/clay-skill-install.js
lib/cli-sessions.js
lib/codex-defaults.js
lib/context-usage.js
lib/daemon.js
lib/default-ai-runtime.js
lib/email-mcp-server.js
lib/kiro-defaults.js
lib/mcp-proxy.js
lib/mcp-query-bridge.js
lib/mcp-source-adapters.js
lib/mcp-source-context.js
lib/mcp-source-discovery.js
lib/mcp-source-plugins.js
lib/mcp-source-restrictions.js
lib/mcp-tool-policy.js
lib/os-user-diagnostics.js
lib/os-users.js
lib/project-connection.js
lib/project-http.js
lib/project-mcp.js
lib/project-pair-result-delivery.js
lib/project-pair-usage.js
lib/project-session-history-actions.js
lib/project-session-pair.js
lib/project-session-runtime-actions.js
lib/project-session-spawn.js
lib/project-session-vendor.js
lib/project-sessions.js
lib/project-vendor-login.js
lib/public/app.js
lib/public/modules/app-header.js
lib/public/modules/app-loop-ui.js
lib/public/modules/app-messages.js
lib/public/modules/app-notifications.js
lib/public/modules/app-panels.js
lib/public/modules/app-rate-limit.js
lib/public/modules/mcp-connection-view.js
lib/public/modules/permission-control.js
lib/public/modules/scheduler.js
lib/public/modules/settings-defaults.js
lib/public/modules/tools.js
lib/public/modules/tui-grab.js
lib/public/modules/vendor-login-browser.js
lib/public/modules/vendor-login.js
lib/safe-bash-commands.js
lib/sdk-bridge.js
lib/sdk-mcp-descriptors.js
lib/sdk-message-processor.js
lib/sdk-quota-snapshot.js
lib/sdk-response-recovery.js
lib/sdk-worker.js
lib/server.js
lib/session-hygiene.js
lib/session-permission-mode.js
lib/sessions.js
lib/tool-llm.js
lib/tui-transcript-index.js
lib/vendor-login-browser.js
lib/yoke/acp-agent-profiles.js
lib/yoke/adapters/antigravity.js
lib/yoke/adapters/claude-query-contract.js
lib/yoke/adapters/claude.js
lib/yoke/adapters/codex-query-contract.js
lib/yoke/adapters/codex.js
lib/yoke/adapters/kiro.js
lib/yoke/auth-events.js
lib/yoke/claude-hook-installer.js
lib/yoke/claude-jsonl-watcher.js
lib/yoke/claude-maintenance.js
lib/yoke/claude-permission-patterns.js
lib/yoke/claude-response-recovery.js
lib/yoke/claude-transcript-hygiene.js
lib/yoke/clay-skill-install.js
lib/yoke/cli-sessions.js
lib/yoke/codex-app-server.js
lib/yoke/configuration.js
lib/yoke/discovery.js
lib/yoke/errors.js
lib/yoke/host-environment.js
lib/yoke/index.js
lib/yoke/interface.js
lib/yoke/kiro-acp-server.js
lib/yoke/legacy-sessions.js
lib/yoke/login-protocol.js
lib/yoke/maintenance.js
lib/yoke/mcp-proxy.js
lib/yoke/mcp-source-adapters.js
lib/yoke/mcp-source-context.js
lib/yoke/mcp-source-discovery.js
lib/yoke/mcp-source-plugins.js
lib/yoke/mcp-source-restrictions.js
lib/yoke/mcp-tool-policy-normalize.js
lib/yoke/model-preferences.js
lib/yoke/options/acp.js
lib/yoke/options/antigravity.js
lib/yoke/options/claude.js
lib/yoke/options/codex-defaults.js
lib/yoke/options/codex-settings.js
lib/yoke/options/codex.js
lib/yoke/options/kiro-defaults.js
lib/yoke/options/kiro.js
lib/yoke/provider-contract.js
lib/yoke/providers/antigravity-executable.js
lib/yoke/providers/claude-executable.js
lib/yoke/providers/claude-model-descriptions.js
lib/yoke/providers/claude-process.js
lib/yoke/providers/claude-provision.js
lib/yoke/providers/codex-errors.js
lib/yoke/provisioning.js
lib/yoke/query-options.js
lib/yoke/response-recovery.js
lib/yoke/sdk-mcp-descriptors.js
lib/yoke/sdk-server-factory.js
lib/yoke/session-history.js
lib/yoke/session-tool-transport.js
lib/yoke/settings.js
lib/yoke/source-locations.js
lib/yoke/tui-transcript-index.js
lib/yoke/usage.js
lib/yoke/user-input.js
lib/yoke/vendor-registry.js
test/claude-sdk-options.test.js
test/codex-recovery-admission.test.js
test/fixtures/clay-final-integration.cjs
test/fixtures/mate-scheduling-runtime.cjs
test/helpers/run-yoke-contract-regressions.sh
test/helpers/yoke-no-provider-processes.cjs
test/issues-launch-hardening.test.js
test/mcp-connections.test.js
test/permission-mode-ui.test.js
test/rate-limit-vendor.test.js
test/scheduled-task-refinements.test.js
test/sdk-bridge-delivery.test.js
test/sdk-response-recovery.test.js
test/yoke-executable-discovery.test.js
test/yoke-query-contract.test.js
test/yoke-runtime-services.test.js
test/yoke-settings-controller.test.js
```
