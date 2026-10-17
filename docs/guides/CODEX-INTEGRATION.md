# Codex Integration Guide

How Clay integrates with the OpenAI Codex CLI via the `codex app-server` protocol. Read this before changing anything in `lib/yoke/adapters/codex.js` or `lib/yoke/codex-app-server.js`.

---

## Architecture Overview

```
Clay session (vendor=codex)
    |
    v
YOKE Codex Adapter  (lib/yoke/adapters/codex.js)
    |
    v
CodexAppServer      (lib/yoke/codex-app-server.js)
    |  spawn codex app-server
    v  stdin/stdout JSON-RPC (bidirectional)
codex CLI binary    (@openai/codex)
    |
    +--> local MCP servers (from ~/.clay/mcp.json)
    +--> clay-tools MCP bridge  (lib/yoke/mcp-bridge-server.js)
           |  HTTP POST
           v
         Global MCP endpoint   (lib/server.js /api/mcp-bridge)
           |
           v
         Project MCP handler  (lib/project.js getMcpBridgeHandler)
           |
           +--> in-app servers (clay-debate, clay-browser, clay-email)
           +--> remote servers (extension-proxied via WS)
```

---

## Why app-server, Not `@openai/codex-sdk`

The SDK package (`@openai/codex-sdk`) runs `codex exec --experimental-json` and **closes stdin immediately** after writing the prompt:

```js
child.stdin.write(args.input);
child.stdin.end();  // <-- one-way pipe
```

This makes **interactive approval impossible**. Every approval request (command execution, file changes, MCP tool calls) is auto-cancelled because the CLI cannot receive a response on a closed stdin.

`codex app-server` is the proper protocol used by the VS Code extension. It uses JSON-RPC 2.0 over stdin/stdout, keeps stdin open, and supports bidirectional messaging.

Do not go back to the SDK exec mode. It is a one-shot pipe wrapper, not a real SDK.

---

## Key Files

| File | Purpose |
|------|---------|
| `lib/yoke/adapters/codex.js` | YOKE adapter. Init, createQuery, event flattening, approval routing, skill injection. |
| `lib/yoke/codex-app-server.js` | Child process manager. Spawn, stdin/stdout JSON-RPC, request ID tracking, pending callbacks. |
| `lib/yoke/mcp-bridge-server.js` | Stdio MCP server spawned by Codex. Proxies tool list/call to Clay via HTTP. |
| `lib/server.js` (`/api/mcp-bridge`) | Global HTTP endpoint. Aggregates MCP servers from all project contexts. |
| `lib/project.js` (`getMcpBridgeHandler`) | Builds per-project MCP tool list + call handler. |
| `lib/project-mcp.js` | Remote MCP proxy server builder (extension-bridged). |
| `lib/sdk-bridge.js` | YOKE-agnostic query orchestration. Handles abort post-loop, vendor routing. |
| `lib/sdk-message-processor.js` | Converts yokeType events to client-facing messages. |
| `lib/sessions.js` | Per-vendor state (slashCommands, capabilities, models). |

---

## Critical Patterns

### 1. Approval response format

App-server expects **structured responses**, not strings:

```js
// Command / file change approval
appServer.respond(msg.id, { decision: "accept" });   // or "decline"

// MCP elicitation (different struct!)
appServer.respond(msg.id, { action: "accept" });     // or "decline"
```

If you send `"accept"` as a plain string, the server logs:
```
failed to deserialize ...: invalid type: string "accept", expected struct
```
and treats it as rejection.

### 2. Config via `--config` CLI flags

App-server reads config from `--config key=value` flags, not env vars:

```js
args.push("--config", 'mcp_servers.clay-tools.command="/path/to/node"');
args.push("--config", 'mcp_servers.clay-tools.args=["script.js", "--flag"]');
```

See `serializeConfig()` in `codex-app-server.js`. Values must be valid TOML literals (strings quoted, arrays in brackets, etc).

### 3. Global MCP bridge endpoint

The bridge server (`mcp-bridge-server.js`) is spawned by Codex at app-server init time. It captures the project slug at spawn and keeps it forever. Codex adapter is a **singleton** across sessions, so if the user switches projects, the bridge still uses the old slug.

**Solution**: bridge calls the global endpoint `/api/mcp-bridge` (not `/p/{slug}/api/mcp-bridge`). The global endpoint picks any project context with a bridge handler. This works because a single Clay server usually has one active project doing Codex work at a time.

Do not revert to project-scoped URLs unless you also redesign the Codex adapter lifecycle.

### 4. Bridge tool list: always re-fetch

The extension may connect after the bridge server starts. If the bridge caches its first `tools/list` response, it misses remote MCP servers that came online later.

`mcp-bridge-server.js` `handleToolsList` calls `fetchTools()` every time. Do not cache.

### 5. Extension state resend on WS reconnect

`app-misc.js` caches the last `browser_tab_list` and `mcp_servers_available` messages from the extension. On WS reconnect (server restart, project switch), `flushPendingExtMessages()` resends them so the server re-registers `_extensionWs` and rebuilds remote MCP proxies.

Do not remove this. Without it, server restart leaves MCP permanently broken until page reload.

### 6. Approval events go through `canUseTool`

All three approval types use the same `canUseTool` callback:

```js
// Command execution
canUseTool("Bash", { command }, {}).then(decision => {...});

// File change
canUseTool("Edit", { changes, path }, {}).then(decision => {...});

// MCP tool call
canUseTool("mcp__<server>__<tool>", params, {}).then(decision => {...});
```

The callback returns `{ behavior: "allow" | "deny", updatedInput }`. Use `isApproved(decision)` helper to check (not `decision === true`).

### 7. Abort flow

Clicking stop in the UI sends `{ type: "stop" }`. The server sets `session.taskStopRequested = true` and calls `session.abortController.abort()`.

The Codex adapter listens to the abort signal and calls `handle.abort()`, which:
1. Sets `state.aborted = true`
2. Sends `turn/interrupt` request to app-server (not notification!)
3. Resolves `turnResolve` and `endIterator()`

`sdk-bridge.js` post-loop then checks `session.taskStopRequested` and sends the interrupted message + done event. `done` triggers `stopThinking()`, `finalizeAssistantBlock()`, etc on the client.

### 8. Event filter after abort

After `state.aborted = true`, ignore most events but let these through:
- `turn/completed` (may still arrive)
- `turn/failed`
- `serverRequest/resolved`
- `thread/status/changed`

This matters when the server replies to the in-flight `turn/interrupt`.

### 9. Thread ID filtering

App-server is singleton but sessions can switch mid-turn. Filter events by `params.threadId !== state.threadId` to prevent old-thread events leaking into new sessions.

### 10. Skills

Codex skills live at `~/.codex/skills/<name>/SKILL.md`. Clay also reads Claude skills at `~/.claude/skills/<name>/SKILL.md`.

At init, the adapter calls `skills/list` with `perCwdExtraUserRoots` pointing to the Claude skills directory. At turn start, if the user text contains `$<skill-name>`, the adapter injects an extra input item:

```js
input.push({ type: "skill", name: "skill-creator", path: "/absolute/path/SKILL.md" });
```

Without the input item, Codex sees `$skill-name` as plain text.

### 11. Vendor-specific slash commands

`sm.slashCommandsByVendor` stores per-vendor command lists. On session switch, `sessions.js` sends the right list for that session's vendor:

```js
_send({ type: "slash_commands", commands: _vendorCmds, vendor: _sessionVendor });
```

Do not go back to a single shared `sm.slashCommands`.

### 12. Sandbox and approval defaults

Stored in `lib/codex-defaults.js`. Do not scatter defaults across multiple files. Server is the single source of truth, clients receive them via `codex_config` message.

`danger-full-access` + `approval_policy: "never"` is a combination the user chose explicitly. Do not auto-upgrade to it from code. It completely disables the sandbox.

### 13. Login does not reach a running app-server

`codex app-server` reads `~/.codex/auth.json` **once, at spawn**. One app-server is shared by every Codex session in a project (`_appServer` in the adapter), so running `codex login` in a terminal changes nothing for sessions that are already up: every query keeps getting 401 -> `auth_required`, and the client keeps re-opening the login flow.

The fix is a restart, not a re-read. `lib/project-vendor-login.js` owns the login terminal, watches its output for the vendor's success line, and then calls `adapter.shutdown()` (which fans out to `shutdownUserRuntimes`, so per-OS-user runtimes are covered too). The next query re-inits and spawns a process that reads the new credentials.

Consequences to preserve:

- **One login terminal per vendor per project.** The server holds the record; `auto` requests (driven by `auth_required`) never open a second prompt while a flow is live. Client-side flags are not a substitute - they reset on banner dismiss.
- **The login terminal must spawn with the identity the adapter will use.** The adapter only gets `osUserInfo` when `_runtimeLinuxUser` is set, which comes from the *session owner*, not the connected client. `resolveLoginIdentity()` prefers the session identity so credentials land in the HOME the app-server reads.
- **Split panes forward, they do not start.** A pane has no banner surface, so it posts `clay-pane-auth-required` to the parent shell (`pane-bridge.js` -> `split-view.js`) rather than running its own flow.

### 14. Choosing a different codex binary

`findCodexPath()` honors `CLAY_CODEX_PATH`: if it points at an existing file, that binary is used and logged; otherwise resolution falls back to the bundled `@openai/codex` platform package. Bundled remains the default - use the override for a local build or a pinned release, not as normal configuration.

### 15. Thinking requires reasoning summaries to be requested

The adapter maps `item/reasoning/summaryTextDelta`, `item/reasoning/textDelta`, and `item/reasoning/summaryPartAdded` onto `thinking_start` / `thinking_delta`. Those notifications only carry text when the app-server is *asked* for reasoning summaries: a reasoning item's own content is encrypted for ChatGPT-authenticated models, so the summary stream is the only readable channel.

Left alone, the app-server inherits `~/.codex/config.toml`, where `model_reasoning_summary` defaults to `"auto"` and often yields nothing. Clay therefore injects, in `CODEX_REASONING_DEFAULTS` (`yoke/adapters/codex.js`):

```toml
model_reasoning_summary = "detailed"
model_supports_reasoning_summaries = true
```

These are merged **before** `adapterOptions.CODEX.config`, so a user config key of the same name wins. `show_raw_agent_reasoning` is intentionally not set - it is encrypted on ChatGPT-auth models and noisy elsewhere, so it stays a user opt-in.

This is server-level `--config`, not a `thread/start` parameter, so it applies to every thread on the shared app-server, including one-shot capsule calls (`complete-once.js` spawns nothing of its own). Do not try to vary it per query without accepting a second app-server process.

---

## Common Gotchas

**"user cancelled MCP tool call"** 
Response was a string instead of `{ action: "accept" }` object. See pattern 1.

**MCP servers not showing after server restart**
Extension state cache was not resent. See pattern 5.

**Tool call timeout after 30s**
Extension `_extensionWs` is stale. `handleExtensionDisconnect()` should fire on disconnect to clear it.

**Codex sees stale tool list**
Bridge server is caching. Always re-fetch (pattern 4).

**Slash commands from wrong vendor**
You reintroduced a shared `sm.slashCommands`. Use `slashCommandsByVendor`.

**Abort leaves typing indicator**
`session.taskStopRequested` is undefined. The `type: "stop"` handler must set it (see `lib/project-sessions.js`).

**`dynamic tool name is reserved: mcp__...`**
Codex app-server rejects dynamic tool names equal to `mcp`, starting with `mcp__`, outside `^[a-zA-Z0-9_-]+$`, or over 128 characters. Never pass Clay names to `thread/start` directly; `yoke/codex-dynamic-tool-names.js` aliases them and resolves calls back to the original name.

**`--config` shows up but value is wrong**
Value is not valid TOML. Strings need quotes, arrays need brackets. See `toTomlValue()` in `codex-app-server.js`.

---

## Testing Checklist

When changing Codex adapter code:

- [ ] Text response streams in real time (`item/agentMessage/delta`)
- [ ] Thinking indicator shows and clears
- [ ] Bash command with `approval: on-request` shows approval UI, responds correctly to Sure/Always/No
- [ ] File change outside workspace shows approval UI
- [ ] MCP tool (filesystem) with `approval: on-request` shows approval UI, executes after approval
- [ ] Multi-turn conversation works (2nd message sends to same thread)
- [ ] Session resume works after server restart
- [ ] Switching between Codex and Claude sessions shows correct slash commands for each
- [ ] `$<skill-name>` references inject skill input items
- [ ] Stop button during generation: typing clears, "interrupted" message appears, send button restored
- [ ] Server restart does not break MCP (extension state resends)
- [ ] Second project using Codex routes through global `/api/mcp-bridge` (not per-slug)
- [ ] `auth_required` opens exactly one login terminal, no matter how many sessions or panes report it
- [ ] Finishing `codex login --device-auth` closes the login terminal, drops it from the sidebar list, and shows "Signed in to Codex"
- [ ] The next message in the *same* session succeeds without opening a new session
- [ ] Dismissing the login modal kills its terminal instead of leaving it in the sidebar

---

## Reference Docs

Official Codex docs are copied to `docs/guides/codex-reference/`:

- `llms.txt` - short index
- `llms-full.txt` - full protocol reference, including:
  - App-server protocol (section "Codex App Server")
  - Approval flows (command execution, file change, MCP, requestUserInput)
  - Skills protocol (`skills/list`, `$<skill-name>` input)
  - Configuration reference (`approval_policy`, `sandbox_mode`, MCP servers)

Search these when you need to know the exact JSON-RPC method names, params, or response shapes.

---

## When Things Get Weird

1. Check server console for `[yoke/codex]`, `[codex-app-server]`, `[mcp-bridge-http]` logs.
2. Check browser console for `[mcp]` tool call logs.
3. Check `docs/guides/codex-reference/llms-full.txt` for protocol details.
4. Check extension service worker console (`chrome://extensions` -> Clay -> Service Worker).
5. If the extension seems stuck, reload it in `chrome://extensions`. The content script auto-reconnect should handle most cases but not extension ID changes.

---

## Files You Should Not Casually Change

- `lib/yoke/codex-app-server.js` - JSON-RPC transport. Changes here affect every adapter operation.
- `lib/yoke/mcp-bridge-server.js` - Running as a child process of Codex. Changes only take effect on new app-server spawn.
- `lib/server.js` `/api/mcp-bridge` endpoint - Used by all Codex instances. Do not add per-project state here.
- `lib/codex-defaults.js` - Single source of truth. Do not duplicate defaults elsewhere.
