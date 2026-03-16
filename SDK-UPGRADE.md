# Claude Agent SDK Upgrade Tracker

Current: `@anthropic-ai/claude-agent-sdk@0.2.76` (Claude Code 2.1.76)
Updated: 2026-03-17

Covers all unapplied changes from 0.2.38 through 0.2.76.


## Priority 1 - High (Functional gaps, user-facing impact) -- DONE

### 1.1 `onElicitation` callback (since 0.2.39+)
- **Status:** Not implemented
- **What:** MCP servers can request user input (OAuth login, form fields) via elicitation. Without this callback, all elicitation requests are auto-declined.
- **Impact:** Slack, GitHub, and other OAuth-based MCP servers cannot authenticate through the relay UI.
- **Where:** `sdk-bridge.js` - add `onElicitation` to queryOptions in `startQuery()`. Forward elicitation requests to the client via WebSocket, collect user response, return result.
- **Types:** `ElicitationRequest`, `ElicitationResult`, `OnElicitation`, `SDKElicitationCompleteMessage`
- **Related messages:** `SDKElicitationCompleteMessage` (new message type to handle)

### 1.2 `setEffort()` mid-query method (since 0.2.45+)
- **Status:** Partially implemented (effort passed at query creation, but no mid-query change)
- **What:** Change effort level on an active query without restarting it.
- **Impact:** UI already has effort selector. Currently changing effort mid-conversation requires a new query.
- **Where:** `sdk-bridge.js` - add `setEffort(session, effort)` method similar to `setModel()`. Call `session.queryInstance.setEffort(effort)`.

### 1.3 npm upgrade to 0.2.76 (prerequisite for all below)
- **Status:** Pending
- **What:** `npm install @anthropic-ai/claude-agent-sdk@0.2.76`
- **Impact:** Required for all new APIs. Peer dependency changed to `zod ^4.0.0`.
- **Breaking:** `PermissionMode` removed `'delegate'` option (was in 0.2.38, gone by 0.2.63). Verify no code references it.


## Priority 2 - Medium (Improved reliability, better UX)

### 2.1 `listSessions()` top-level function (since 0.2.51+)
- **Status:** Not implemented
- **What:** SDK-level session listing with pagination support. Replaces manual file system reading of `~/.claude/projects/` directories.
- **Impact:** More reliable session discovery, handles edge cases (worktrees, symlinks) that manual FS reading might miss.
- **Where:** Session manager code that currently reads session files directly.
- **Options:** `{ dir?: string, limit?: number }`

### 2.2 `getSessionMessages()` top-level function (since 0.2.51+)
- **Status:** Not implemented
- **What:** Read session conversation messages with pagination.
- **Impact:** Could replace or supplement current session history replay. Useful for session preview/search features.
- **Options:** `{ dir?: string, limit?: number, offset?: number }`

### 2.3 `getSessionInfo()` top-level function (since 0.2.74+)
- **Status:** Not implemented
- **What:** Lightweight single-session metadata lookup (vs listing all sessions).
- **Impact:** Faster session info retrieval without scanning all sessions.

### 2.4 `agentProgressSummaries` query option (since 0.2.72+)
- **Status:** Not implemented
- **What:** AI-generated periodic progress summaries for running sub-agents. Piggybacks on prompt cache, so nearly free.
- **Impact:** Better sub-agent progress visibility in UI. Currently only tool names/descriptions are shown.
- **Where:** `sdk-bridge.js` - add `agentProgressSummaries: true` to queryOptions. Handle new summary messages in `processSDKMessage()`.

### 2.5 `forkSession()` top-level function (since 0.2.76+)
- **Status:** Not implemented
- **What:** Branch a conversation from a specific message point. Creates a new session with transcript sliced at `upToMessageId`.
- **Impact:** Enables "branch conversation" UI feature. Reuses prompt cache, so cost is minimal.
- **Options:** `{ upToMessageId?: string, title?: string, dir?: string }`
- **Returns:** `{ sessionId: string }`


## Priority 3 - Low (Nice-to-have, polish)

### 3.1 `renameSession()` top-level function (since 0.2.74+)
- **Status:** Not implemented
- **What:** Rename a session title via SDK.
- **Impact:** Currently session titles are managed locally. SDK rename keeps CLI and relay in sync.

### 3.2 `tagSession()` top-level function (since 0.2.76+)
- **Status:** Not implemented
- **What:** Attach/detach a tag string to a session.
- **Impact:** Could enable session categorization/filtering in UI.

### 3.3 `supportedAgents()` query method (since 0.2.51+)
- **Status:** Not implemented
- **What:** Get list of available sub-agent types with names, descriptions, and models.
- **Impact:** Could show agent capabilities in UI when Task tool is used.

### 3.4 `ThinkingConfig` types (since 0.2.51+)
- **Status:** Not implemented
- **What:** `ThinkingAdaptive | ThinkingEnabled | ThinkingDisabled` config for controlling extended thinking.
- **Impact:** Fine-grained thinking control. Current code doesn't expose thinking settings.

### 3.5 `ToolConfig` type (since 0.2.76+)
- **Status:** Not implemented
- **What:** Configure AskUserQuestion preview format (`'markdown'` vs `'html'`).
- **Impact:** Relay is web-based, so `'html'` preview mode would render better than markdown in monospace boxes.

### 3.6 New hook events (since 0.2.51+, 0.2.76+)
- **Status:** Not implemented
- **What:** New hook event types available:
  - `Elicitation` / `ElicitationResult` (0.2.51+)
  - `ConfigChange` (0.2.51+)
  - `WorktreeCreate` / `WorktreeRemove` (0.2.51+)
  - `PostCompact` (0.2.76+)
  - `InstructionsLoaded` (0.2.76+)
- **Impact:** Only relevant if hook system is used. Currently no hooks are registered.

### 3.7 `AgentDefinition.model` expanded type (since 0.2.76+)
- **Status:** Not impactful yet
- **What:** Model field changed from `'sonnet' | 'opus' | 'haiku' | 'inherit'` to `string` (accepts full model IDs like `'claude-opus-4-5'`).
- **Impact:** No code change needed unless custom agent definitions are used.

### 3.8 `Settings` interface export (since 0.2.76+)
- **Status:** Not implemented
- **What:** TypeScript Settings interface now exported from SDK.
- **Impact:** Useful for type-checking settings objects if migrating to TypeScript.


## Already Implemented (0.2.38 -> 0.2.63 range)

These were added between 0.2.38 and 0.2.63 and are already integrated:

- [x] `promptSuggestions` query option + `SDKPromptSuggestionMessage` handling
- [x] `SDKRateLimitEvent` / `rate_limit_event` with UI display
- [x] `SDKTaskStartedMessage` / `SDKTaskProgressMessage` with sub-agent tracking
- [x] `FastModeState` with UI indicator (zap icon)
- [x] `stopTask()` method with fallback abort
- [x] `supportedModels()` in warmup
- [x] `forkSession` option on QueryOptions (boolean flag, not the top-level function)
- [x] `betas` query option support
- [x] `effort` query option at creation time


## Upgrade Steps

1. Check `zod` peer dependency compatibility (needs `^4.0.0`)
2. `npm install @anthropic-ai/claude-agent-sdk@0.2.76`
3. Verify no references to removed `PermissionMode: 'delegate'`
4. Implement Priority 1 items
5. Implement Priority 2 items as needed
6. Priority 3 items can be done incrementally
