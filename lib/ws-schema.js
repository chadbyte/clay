/**
 * WebSocket message type registry.
 *
 * Documents every message type flowing between client and server.
 * Each entry: { direction, handler, description }
 *   direction: "c2s" (client to server), "s2c" (server to client), "both" (bidirectional)
 *   handler: file path where this message type is processed
 *   description: brief description
 *
 * This file is informational. It is not imported at runtime.
 * Use it as a reference when adding new message types.
 */

var schema = {

  // -----------------------------------------------------------------------
  // Session management
  // -----------------------------------------------------------------------
  "switch_session":           { direction: "c2s", handler: "lib/project-sessions.js", description: "Switch the active session by local ID" },
  "resume_tui_session":       { direction: "c2s", handler: "lib/project-sessions.js", description: "Spawn the claude --resume PTY for a TUI session shown read-only (lazy resume)" },
  "suspend_tui_session":      { direction: "c2s", handler: "lib/project-sessions.js", description: "Close a live TUI session's PTY now but keep it resumable (explicit Close)" },
  "new_session":              { direction: "c2s", handler: "lib/project-sessions.js", description: "Create a new blank session (opts: vendor, mode, sessionVisibility, dangerouslySkipPermissions)" },
  "delete_session":           { direction: "c2s", handler: "lib/project-sessions.js", description: "Delete a session by ID" },
  "rename_session":           { direction: "c2s", handler: "lib/project-sessions.js", description: "Rename a session" },
  "set_session_bookmark":     { direction: "c2s", handler: "lib/project-sessions.js", description: "Bookmark or unbookmark a session in the sidebar" },
  "reorder_session_bookmarks": { direction: "c2s", handler: "lib/project-sessions.js", description: "Reorder favorited sessions within the favorites area" },
  "bulk_delete_sessions":    { direction: "c2s", handler: "lib/project-sessions.js", description: "Delete a group of sessions at once" },
  "set_session_visibility":   { direction: "c2s", handler: "lib/project-sessions.js", description: "Show or hide a session in the sidebar" },
  "search_sessions":          { direction: "c2s", handler: "lib/project-sessions.js", description: "Search session titles" },
  "search_session_content":   { direction: "c2s", handler: "lib/project-sessions.js", description: "Full-text search within a session" },
  "load_more_history":        { direction: "c2s", handler: "lib/project-sessions.js", description: "Request older history entries for the current session" },
  "fork_session":             { direction: "c2s", handler: "lib/project-sessions.js", description: "Fork a session from a given message UUID" },
  "handoff_session":          { direction: "c2s", handler: "lib/project-session-handoff.js", description: "Continue the active session in a newly created agent session" },
  "handoff_session_options":  { direction: "c2s", handler: "lib/project-session-handoff.js", description: "Request vendors, models, and effort capabilities for the handoff dialog (response reuses the same type)" },
  "input_sync":               { direction: "c2s", handler: "lib/project-sessions.js", description: "Sync the current input field text to other clients" },
  "tui_transcript_request":   { direction: "c2s", handler: "lib/project-sessions.js", description: "Ask for the assistant text index of a Claude TUI session (for hover-to-grab)" },
  "split_group_create":       { direction: "c2s", handler: "lib/session-split-groups.js", description: "Create a persistent two-session split group" },
  "split_group_rename":       { direction: "c2s", handler: "lib/session-split-groups.js", description: "Rename a split group" },
  "split_group_dissolve":     { direction: "c2s", handler: "lib/session-split-groups.js", description: "Separate a split group without deleting its sessions" },
  "split_group_set_pair":     { direction: "c2s", handler: "lib/session-split-groups.js", description: "Assign Driver/Worker roles on a split group (driverId null clears them)" },
  "pair_session_options":     { direction: "c2s", handler: "lib/project-session-pair.js", description: "Request vendors/models for the pair-session dialog (response reuses the same type)" },
  "pair_session_create":      { direction: "c2s", handler: "lib/project-session-pair.js", description: "Create a Driver/Split Worker session pair as a split group" },
  "worker_proposal_response": { direction: "c2s", handler: "lib/project-worker-proposal.js", description: "Accept or decline an exact Driver Split Worker configuration with the selected runtime" },
  "project_assignment_response": { direction: "c2s", handler: "lib/workspace-assignment-service.js", description: "Approve or cancel an exact-session cross-project assignment proposal" },
  "home_clay_session_resolve": { direction: "c2s", handler: "lib/server-home-chat.js", description: "Resolve an opaque Mate session reference through the exact bound source session" },
  "home_clay_session_target": { direction: "s2c", handler: "lib/public/modules/command-palette.js", description: "Return an owner-validated navigation target for a rendered Mate session reference" },
  "home_clay_log_resolve":     { direction: "c2s", handler: "lib/server-home-chat.js", description: "Resolve an opaque Project Log reference through the exact bound Clay session" },
  "home_clay_log_target":      { direction: "s2c", handler: "lib/public/modules/command-palette.js", description: "Return an owner-validated project target for a rendered Log reference" },

  "session_list":             { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Full list of sessions for the sidebar" },
  "session_switched":         { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Confirmation that active session changed" },
  "session_id":               { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "CLI session ID assigned to the current session" },
  "session_presence":         { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Which users are present in which sessions" },
  "session_io":               { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Notify that a session has new output activity" },
  "session_unread":           { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Unread message count for a session" },
  "search_results":           { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Session title search results" },
  "search_content_results":   { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Full-text content search results" },
  "fork_complete":            { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Fork succeeded, includes new session ID" },
  "session_handoff_result":   { direction: "s2c", handler: "lib/public/modules/session-actions.js", description: "Session handoff result and new target session ID" },
  "handoff_context":          { direction: "s2c", handler: "lib/public/modules/session-actions.js", description: "Timeline marker identifying the source of a handoff session" },
  "handoff_created":          { direction: "s2c", handler: "lib/public/modules/session-actions.js", description: "Timeline marker linking a source session to its handoff target" },
  "input_sync_broadcast":     { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Broadcast input text from another client" },
  "tui_transcript_state":     { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Assistant text index for a Claude TUI session (full replace; sent on request and after each new assistant message)" },
  "split_groups":             { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Full persistent split-group list for the current user" },
  "split_group_result":       { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Result of a split-group mutation" },
  "pair_session_created":     { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Result of pair_session_create; carries the new group" },
  "worker_proposal":          { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Recorded Split Worker creation/replacement runtime card with Driver rationale" },
  "worker_proposal_update":   { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Worker card lifecycle and manual/auto decision audit update" },
  "project_assignment_proposal": { direction: "s2c", handler: "lib/public/modules/app-message-router.js", description: "Approval card for a new owner-bound project assignment" },
  "project_assignment_status": { direction: "s2c", handler: "lib/public/modules/app-message-router.js", description: "Durable project assignment lifecycle update" },
  "project_assignment_error": { direction: "s2c", handler: "lib/public/modules/app-message-router.js", description: "Rejected or stale project assignment response" },
  "home_project_assignment_proposal": { direction: "s2c", handler: "lib/public/modules/app-message-router.js", description: "Home-projected exact-session assignment approval card" },
  "home_project_assignment_status": { direction: "s2c", handler: "lib/public/modules/app-message-router.js", description: "Home-projected exact-session assignment lifecycle" },
  "split_delegation":         { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "A pair delegation started or ended (drives the split-view flow indicator)" },

  // -----------------------------------------------------------------------
  // History replay
  // -----------------------------------------------------------------------
  "history_meta":             { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Metadata about history replay (total count, starting index)" },
  "history_prepend":          { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Batch of older history entries prepended to timeline" },
  "history_done":             { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "History replay finished, includes last usage stats" },

  // -----------------------------------------------------------------------
  // Chat / streaming
  // -----------------------------------------------------------------------
  "message":                  { direction: "c2s", handler: "lib/project-user-message.js", description: "Send an idempotent user chat message; message_ack confirms persistence" },
  "message_ack":              { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Confirm that an idempotent user chat message was persisted" },
  "user_message":             { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Echo of the user message in the timeline" },
  "delta":                    { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Incremental text delta from the assistant" },
  "result":                   { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Final assistant result text" },
  "status":                   { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Processing status update (e.g. 'processing')" },
  "done":                     { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Query complete, includes exit code" },
  "error":                    { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Error message from server" },
  "info":                     { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Project info payload sent on connection" },
  "stderr":                   { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "stderr output from Claude process" },
  "compacting":               { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Conversation compaction in progress (active: true/false)" },
  "message_uuid":             { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "UUID assigned to a user or assistant message" },
  "prompt_suggestion":        { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Suggested follow-up prompt from the assistant" },
  "model_refusal":            { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Model declined the request (fallback to another model, or no fallback)" },
  "informational":            { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Leveled informational message from the agent (info/notice/suggestion/warning)" },
  "permission_denied":        { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "A tool call was denied; explains why" },
  "thinking_tokens":          { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Live thinking-token estimate (ephemeral)" },
  "context_preview":          { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Preview of context sources included in a query" },

  // -----------------------------------------------------------------------
  // Thinking
  // -----------------------------------------------------------------------
  "thinking_start":           { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Assistant started a thinking block" },
  "thinking_delta":           { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Incremental thinking text delta" },
  "thinking_stop":            { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Thinking block finished, includes duration" },

  // -----------------------------------------------------------------------
  // Tools
  // -----------------------------------------------------------------------
  "tool_start":               { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Assistant started a tool use block" },
  "tool_executing":           { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Tool is executing with parsed input" },
  "tool_result":              { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Tool execution result" },
  "slash_command_result":     { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Output of a slash command" },

  // -----------------------------------------------------------------------
  // Subagents / tasks
  // -----------------------------------------------------------------------
  "subagent_activity":        { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Activity indicator for a subagent" },
  "subagent_tool":            { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Subagent tool use event" },
  "subagent_done":            { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Subagent task completed" },
  "task_started":             { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Background task started" },
  "task_progress":            { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Background task progress update" },
  "active_background_tasks":  { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Current background tasks for the active session (full replacement)" },
  "markdown_edit_present":    { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Open a user-requested Markdown edit with a before snapshot" },

  // -----------------------------------------------------------------------
  // Permissions
  // -----------------------------------------------------------------------
  "permission_request":       { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Tool permission request from assistant" },
  "permission_request_pending": { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Permission request that was pending when client connected" },
  "permission_response":      { direction: "c2s", handler: "lib/project-sessions.js", description: "User response to a permission request" },
  "permission_resolved":      { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Permission request resolved" },
  "permission_cancel":        { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Permission request cancelled (e.g. interrupted)" },

  // -----------------------------------------------------------------------
  // Ask user (interactive input)
  // -----------------------------------------------------------------------
  "ask_user":                 { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Assistant is requesting user input via ask_user tool" },
  "ask_user_response":        { direction: "c2s", handler: "lib/project-sessions.js", description: "User reply to an ask_user request" },
  "ask_user_answered":        { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Confirmation that ask_user was answered" },

  // -----------------------------------------------------------------------
  // Elicitation
  // -----------------------------------------------------------------------
  "elicitation_request":      { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Structured form elicitation request from assistant" },
  "elicitation_response":     { direction: "c2s", handler: "lib/project-sessions.js", description: "User response to an elicitation form" },
  "elicitation_resolved":     { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Elicitation request resolved" },
  "user_dialog_request":      { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Host dialog request from assistant (SDK request_user_dialog)" },
  "user_dialog_response":     { direction: "c2s", handler: "lib/project-sessions.js", description: "User response to a host dialog request" },
  "user_dialog_resolved":     { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Host dialog request resolved" },

  // -----------------------------------------------------------------------
  // Stop / control
  // -----------------------------------------------------------------------
  "stop":                     { direction: "c2s", handler: "lib/project-sessions.js", description: "Stop the current assistant query" },
  "stop_task":                { direction: "c2s", handler: "lib/project-sessions.js", description: "Stop a specific background task by ID" },
  "kill_process":             { direction: "c2s", handler: "lib/project-sessions.js", description: "Kill a system process by PID" },
  "process_killed":           { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Process was successfully killed" },
  "process_conflict":         { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Conflict: another process is using the session" },
  "session_writer_conflict":  { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Codex session is already open in another process" },

  // -----------------------------------------------------------------------
  // Context / usage
  // -----------------------------------------------------------------------
  "context_usage":            { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Token usage and context window stats" },
  "context_overflow":         { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Conversation too long to continue" },

  // -----------------------------------------------------------------------
  // Auth
  // -----------------------------------------------------------------------
  "auth_required":            { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Authentication required (e.g. API key needed)" },
  "vendor_login_start":       { direction: "c2s", handler: "lib/project-vendor-login.js", description: "Start (or re-attach to) the per-vendor login terminal" },
  "vendor_login_cancel":      { direction: "c2s", handler: "lib/project-vendor-login.js", description: "Dismiss the login flow and kill its terminal" },
  "vendor_login_state_request": { direction: "c2s", handler: "lib/project-vendor-login.js", description: "Ask for the project's active login flows" },
  "vendor_login_ready":       { direction: "s2c", handler: "lib/public/modules/vendor-login.js", description: "Login terminal is available; open/re-attach the modal to it" },
  "vendor_login_state":       { direction: "s2c", handler: "lib/public/modules/vendor-login.js", description: "Active login flows for this project (one per vendor)" },
  "vendor_login_error":       { direction: "s2c", handler: "lib/public/modules/vendor-login.js", description: "The login flow could not be started" },
  "auth_refreshed":           { direction: "s2c", handler: "lib/public/modules/vendor-login.js", description: "Login completed and the vendor adapter was restarted" },

  // -----------------------------------------------------------------------
  // Rate limiting / scheduling
  // -----------------------------------------------------------------------
  "rate_limit":               { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Rate limit hit, includes wait time" },
  "rate_limit_usage":         { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Current rate limit usage stats" },
  "schedule_message":         { direction: "c2s", handler: "lib/project-user-message.js", description: "Schedule a message to be sent at a future time" },
  "send_scheduled_now":       { direction: "c2s", handler: "lib/project-user-message.js", description: "Send the scheduled message immediately" },
  "cancel_scheduled_message": { direction: "c2s", handler: "lib/project-user-message.js", description: "Cancel the pending scheduled message" },
  "scheduled_message_queued": { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Scheduled message has been queued" },
  "scheduled_message_sent":   { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Scheduled message was sent" },
  "scheduled_message_cancelled": { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Scheduled message was cancelled" },
  "auto_continue_scheduled":  { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Auto-continue was scheduled after rate limit" },
  "auto_continue_fired":      { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Auto-continue timer fired" },

  // -----------------------------------------------------------------------
  // Model / config
  // -----------------------------------------------------------------------
  "set_model":                { direction: "c2s", handler: "lib/project-models.js", description: "Set the model for the current session" },
  "get_vendor_models":        { direction: "c2s", handler: "lib/project-models.js", description: "Load a vendor model catalog" },
  "set_server_default_model": { direction: "c2s", handler: "lib/project-sessions.js", description: "Set the server-wide default model" },
  "set_project_default_model": { direction: "c2s", handler: "lib/project-sessions.js", description: "Set the project default model" },
  "set_permission_mode":      { direction: "c2s", handler: "lib/project-sessions.js", description: "Set permission mode for the current session" },
  "set_session_full_access":  { direction: "c2s", handler: "lib/project-sessions.js", description: "Toggle Clay-managed permission skipping for a GUI session" },
  "session_full_access_changed": { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "A session's full-access state changed" },
  "session_full_access_result": { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Result of toggling session full access" },
  "reload_skills":            { direction: "c2s", handler: "lib/project-sessions.js", description: "Hot-reload skills/MCP/agents on the active query without a restart" },
  "set_mcp_permission_mode_override": { direction: "c2s", handler: "lib/project-sessions.js", description: "Override permission mode (default/auto/null) for one MCP server" },
  "set_server_default_mode":  { direction: "c2s", handler: "lib/project-sessions.js", description: "Set the server-wide default permission mode" },
  "set_project_default_mode": { direction: "c2s", handler: "lib/project-sessions.js", description: "Set the project default permission mode" },
  "set_effort":               { direction: "c2s", handler: "lib/project-sessions.js", description: "Set effort level for the current session" },
  "set_server_default_effort": { direction: "c2s", handler: "lib/project-sessions.js", description: "Set the server-wide default effort level" },
  "set_project_default_effort": { direction: "c2s", handler: "lib/project-sessions.js", description: "Set the project default effort level" },
  "set_betas":                { direction: "c2s", handler: "lib/project-sessions.js", description: "Set beta feature flags" },
  "set_thinking":             { direction: "c2s", handler: "lib/project-sessions.js", description: "Set thinking mode and budget" },
  "model_info":               { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Current model and available models list" },
  "model_selection_result":   { direction: "s2c", handler: "lib/public/modules/model-picker.js", description: "Acknowledgement or error for a model selection" },
  "config_state":             { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Full config state: model, mode, effort, betas, thinking" },
  "slash_commands":           { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Available slash commands list" },
  "fast_mode_state":          { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Fast mode toggle state" },
  "client_count":             { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Number of connected clients" },

  // -----------------------------------------------------------------------
  // Rewind
  // -----------------------------------------------------------------------
  "rewind_preview":           { direction: "c2s", handler: "lib/project-sessions.js", description: "Request a preview of rewinding to a message UUID" },
  "rewind_execute":           { direction: "c2s", handler: "lib/project-sessions.js", description: "Execute the rewind to a message UUID" },
  "rewind_preview_result":    { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Rewind preview data and diffs" },
  "rewind_complete":          { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Rewind executed successfully" },
  "rewind_error":             { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Rewind failed" },

  // -----------------------------------------------------------------------
  // Cursors / presence
  // -----------------------------------------------------------------------
  "cursor_move":              { direction: "both", handler: "lib/project-sessions.js", description: "Cursor position update from a user" },
  "cursor_leave":             { direction: "both", handler: "lib/project-sessions.js", description: "User cursor left the viewport" },
  "text_select":              { direction: "both", handler: "lib/project-sessions.js", description: "Text selection ranges from a user" },

  // -----------------------------------------------------------------------
  // Push notifications
  // -----------------------------------------------------------------------
  "push_subscribe":           { direction: "c2s", handler: "lib/project-sessions.js", description: "Register a push notification subscription" },

  // -----------------------------------------------------------------------
  // Updates
  // -----------------------------------------------------------------------
  "set_update_channel":       { direction: "c2s", handler: "lib/project-sessions.js", description: "Set the update channel (stable/beta)" },
  "check_update":             { direction: "c2s", handler: "lib/project-sessions.js", description: "Check if an update is available" },
  "update_now":               { direction: "c2s", handler: "lib/project-sessions.js", description: "Start the update process" },
  "update_snooze":            { direction: "c2s", handler: "lib/project-sessions.js", description: "Snooze the current update notification for an allowlisted duration" },
  "update_snoozed":           { direction: "s2c", handler: "lib/public/modules/update-snooze.js", description: "Result of an update snooze, fanned out to every device of that user" },
  "update_available":         { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "A new version is available" },
  "up_to_date":               { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Server is already on the latest version" },
  "update_started":           { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Update download/install has started; the version field is included only for admin-grade recipients" },

  // -----------------------------------------------------------------------
  // What's New
  // -----------------------------------------------------------------------
  "whats_new_state":          { direction: "s2c", handler: "lib/public/modules/whats-new.js", description: "Unseen What's New entries for the connecting user" },
  "whats_new_seen":           { direction: "c2s", handler: "lib/project-sessions.js", description: "Mark a What's New entry as dismissed by the current user" },
  "whats_new_seen_result":    { direction: "s2c", handler: "lib/public/modules/whats-new.js", description: "Result of marking a What's New entry seen" },
  "home_dock_get":            { direction: "c2s", handler: "lib/server-home-preferences.js", description: "Request the current user's home dock preference" },
  "home_dock_set":            { direction: "c2s", handler: "lib/server-home-preferences.js", description: "Persist the current user's home dock preference" },
  "home_dock_state":          { direction: "s2c", handler: "lib/public/modules/home-dock.js", description: "Current user home dock preference" },
  "home_surface_get":         { direction: "c2s", handler: "lib/server-home-preferences.js", description: "Request the current user's durable primary surface and Home conversation selection" },
  "home_surface_set":         { direction: "c2s", handler: "lib/server-home-preferences.js", description: "Persist the current user's primary surface and Home conversation selection" },
  "home_surface_state":       { direction: "s2c", handler: "lib/public/modules/home-surface.js", description: "Current user primary surface and Home conversation selection" },
  "home_debates_list":        { direction: "c2s", handler: "lib/server-home-debates.js", description: "Request the current user's durable Home debate archive" },
  "home_debates_state":       { direction: "s2c", handler: "lib/public/modules/home-debates-archive.js", description: "Current user's durable Home debate archive" },

  // -----------------------------------------------------------------------
  // Process stats
  // -----------------------------------------------------------------------
  "process_stats":            { direction: "both", handler: "lib/project-sessions.js", description: "Request (c2s) or response (s2c) of system process stats" },

  // -----------------------------------------------------------------------
  // Server settings / daemon
  // -----------------------------------------------------------------------
  "get_daemon_config":        { direction: "c2s", handler: "lib/project-sessions.js", description: "Request daemon configuration" },
  "daemon_config":            { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Daemon configuration payload" },
  "set_pin":                  { direction: "c2s", handler: "lib/project-sessions.js", description: "Set or clear the server access PIN" },
  "set_pin_result":           { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "PIN set result" },
  "set_keep_awake":           { direction: "c2s", handler: "lib/project-sessions.js", description: "Enable or disable keep-awake" },
  "set_keep_awake_result":    { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Keep-awake setting result" },
  "keep_awake_changed":       { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Broadcast: keep-awake state changed" },
  "set_auto_continue":        { direction: "c2s", handler: "lib/project-sessions.js", description: "Enable or disable auto-continue on rate limit" },
  "set_auto_continue_result": { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Auto-continue setting result" },
  "auto_continue_changed":    { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Broadcast: auto-continue state changed" },
  "set_image_retention":      { direction: "c2s", handler: "lib/project-sessions.js", description: "Set image retention period in days" },
  "set_image_retention_result": { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Image retention setting result" },
  "shutdown_server":          { direction: "c2s", handler: "lib/project-sessions.js", description: "Request server shutdown" },
  "shutdown_server_result":   { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Shutdown request result" },
  "restart_server":           { direction: "c2s", handler: "lib/project-sessions.js", description: "Request server restart" },
  "restart_server_result":    { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Restart request result" },
  "toast":                    { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Ephemeral toast notification" },

  // -----------------------------------------------------------------------
  // Projects
  // -----------------------------------------------------------------------
  "browse_dir":               { direction: "c2s", handler: "lib/project-sessions.js", description: "Browse directory entries for project creation" },
  "browse_dir_result":        { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Directory listing result" },
  "add_project":              { direction: "c2s", handler: "lib/project-sessions.js", description: "Add an existing directory as a project" },
  "add_project_result":       { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Add project result" },
  "create_project":           { direction: "c2s", handler: "lib/project-sessions.js", description: "Create a new empty project directory" },
  "clone_project":            { direction: "c2s", handler: "lib/project-sessions.js", description: "Clone a git repository as a new project" },
  "clone_project_progress":   { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Git clone progress indicator" },
  "create_worktree":          { direction: "c2s", handler: "lib/project-sessions.js", description: "Create a git worktree branch as a new project" },
  "create_worktree_result":   { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Worktree creation result" },
  "remove_project_check":     { direction: "c2s", handler: "lib/project-sessions.js", description: "Check how many schedules a project has before removal" },
  "remove_project_check_result": { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Schedule count for project about to be removed" },
  "remove_project":           { direction: "c2s", handler: "lib/project-sessions.js", description: "Remove a project" },
  "remove_project_result":    { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Remove project result" },
  "reorder_projects":         { direction: "c2s", handler: "lib/project-sessions.js", description: "Reorder project list by slug array" },
  "reorder_projects_result":  { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Reorder result" },
  "set_project_title":        { direction: "c2s", handler: "lib/project-sessions.js", description: "Rename a project" },
  "set_project_title_result": { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Rename project result" },
  "set_project_icon":         { direction: "c2s", handler: "lib/project-sessions.js", description: "Set or clear a project emoji icon" },
  "set_project_icon_result":  { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Set icon result" },
  "transfer_project_owner":   { direction: "c2s", handler: "lib/project-sessions.js", description: "Transfer project ownership to another user" },
  "project_owner_changed":    { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Project ownership was transferred" },
  "projects_updated":         { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Broadcast: project list changed" },
  "schedule_move":            { direction: "c2s", handler: "lib/project-sessions.js", description: "Move a schedule to a different project" },
  "schedule_move_result":     { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Schedule move result" },

  // -----------------------------------------------------------------------
  // Filesystem
  // -----------------------------------------------------------------------
  "fs_list":                  { direction: "c2s", handler: "lib/project-filesystem.js", description: "List directory contents" },
  "fs_list_result":           { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Directory listing result" },
  "fs_search":                { direction: "c2s", handler: "lib/project-filesystem.js", description: "Search files by name" },
  "fs_search_result":         { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "File search results" },
  "fs_read":                  { direction: "c2s", handler: "lib/project-filesystem.js", description: "Read file contents" },
  "fs_read_result":           { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "File content result" },
  "fs_write":                 { direction: "c2s", handler: "lib/project-filesystem.js", description: "Write file contents" },
  "fs_write_result":          { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "File write result" },
  "fs_delete":                { direction: "c2s", handler: "lib/project-filesystem.js", description: "Delete a file" },
  "fs_rename":                { direction: "c2s", handler: "lib/project-filesystem.js", description: "Rename a file" },
  "fs_mkdir":                 { direction: "c2s", handler: "lib/project-filesystem.js", description: "Create a directory" },
  "fs_upload":                { direction: "c2s", handler: "lib/project-filesystem.js", description: "Upload a file" },
  "fs_watch":                 { direction: "c2s", handler: "lib/project-filesystem.js", description: "Start watching a file for changes" },
  "fs_unwatch":               { direction: "c2s", handler: "lib/project-filesystem.js", description: "Stop watching a file" },
  "fs_file_changed":          { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Watched file content changed" },
  "fs_dir_changed":           { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Watched directory contents changed" },
  "fs_file_history":          { direction: "c2s", handler: "lib/project-filesystem.js", description: "Request git history for a file" },
  "fs_file_history_result":   { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Git file history entries" },
  "fs_git_diff":              { direction: "c2s", handler: "lib/project-filesystem.js", description: "Request a git diff for a commit/file" },
  "fs_git_diff_result":       { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Git diff result" },
  "fs_file_at":               { direction: "c2s", handler: "lib/project-filesystem.js", description: "Read a file at a specific git commit hash" },
  "fs_file_at_result":        { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "File content at a specific commit" },

  // -----------------------------------------------------------------------
  // Project env / CLAUDE.md
  // -----------------------------------------------------------------------
  "get_project_env":          { direction: "c2s", handler: "lib/project-filesystem.js", description: "Read the project .envrc" },
  "project_env_result":       { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Project .envrc content" },
  "set_project_env":          { direction: "c2s", handler: "lib/project-filesystem.js", description: "Write the project .envrc" },
  "set_project_env_result":   { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Project .envrc write result" },
  "read_global_claude_md":    { direction: "c2s", handler: "lib/project-filesystem.js", description: "Read the global CLAUDE.md" },
  "global_claude_md_result":  { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Global CLAUDE.md content" },
  "write_global_claude_md":   { direction: "c2s", handler: "lib/project-filesystem.js", description: "Write the global CLAUDE.md" },
  "write_global_claude_md_result": { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Global CLAUDE.md write result" },
  "get_shared_env":           { direction: "c2s", handler: "lib/project-filesystem.js", description: "Read the shared .envrc" },
  "shared_env_result":        { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Shared .envrc content" },
  "set_shared_env":           { direction: "c2s", handler: "lib/project-filesystem.js", description: "Write the shared .envrc" },
  "set_shared_env_result":    { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Shared .envrc write result" },

  // -----------------------------------------------------------------------
  // Context sources
  // -----------------------------------------------------------------------
  "context_sources_save":     { direction: "c2s", handler: "lib/project-user-message.js", description: "Save active context source configuration" },
  "context_sources_state":    { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Current active context sources list" },

  // -----------------------------------------------------------------------
  // Terminal
  // -----------------------------------------------------------------------
  "term_create":              { direction: "c2s", handler: "lib/project-user-message.js", description: "Create a new terminal session" },
  "term_created":             { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Terminal was created, includes ID" },
  "term_attach":              { direction: "c2s", handler: "lib/project-user-message.js", description: "Attach to a terminal to receive output" },
  "term_detach":              { direction: "c2s", handler: "lib/project-user-message.js", description: "Detach from a terminal" },
  "term_input":               { direction: "c2s", handler: "lib/project-user-message.js", description: "Send input to a terminal" },
  "term_resize":              { direction: "c2s", handler: "lib/project-user-message.js", description: "Resize a terminal" },
  "term_close":               { direction: "c2s", handler: "lib/project-user-message.js", description: "Close a terminal session" },
  "term_rename":              { direction: "c2s", handler: "lib/project-user-message.js", description: "Rename a terminal tab" },
  "term_output":              { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Terminal output data" },
  "term_resized":             { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Terminal was resized" },
  "term_exited":              { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Terminal process exited" },
  "term_closed":              { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Terminal session was closed" },
  "term_list":                { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Full list of open terminals" },
  "term_error":               { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Terminal error (e.g. access denied)" },
  "shell_command":            { direction: "c2s", handler: "lib/project-shell-command.js", description: "Run a one-shot shell command for agent context" },
  "shell_command_result":     { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "One-shot shell command output and exit status" },

  // -----------------------------------------------------------------------
  // Sticky notes
  // -----------------------------------------------------------------------
  "note_create":              { direction: "c2s", handler: "lib/project-user-message.js", description: "Create a new sticky note" },
  "note_created":             { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Sticky note was created" },
  "note_written":             { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Agent created or updated a sticky note" },
  "note_update":              { direction: "c2s", handler: "lib/project-user-message.js", description: "Update a sticky note" },
  "note_updated":             { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Sticky note was updated" },
  "note_close":               { direction: "c2s", handler: "lib/project-user-message.js", description: "Close a sticky note (reversible; never deletes)" },
  "note_reopen":              { direction: "c2s", handler: "lib/project-user-message.js", description: "Reopen a closed sticky note" },
  "note_delete":              { direction: "c2s", handler: "lib/project-user-message.js", description: "Retired: older clients still send this; handled as a non-destructive close" },
  "note_deleted":             { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Retired: never sent. Closing broadcasts note_updated instead" },
  "note_list_request":        { direction: "c2s", handler: "lib/project-user-message.js", description: "Request the full notes list" },
  "note_bring_front":         { direction: "c2s", handler: "lib/project-user-message.js", description: "Bring a note to front (update z-order)" },
  "notes_list":               { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Full list of sticky notes" },

  // -----------------------------------------------------------------------
  // Project Logs
  // -----------------------------------------------------------------------
  "project_logs_list":        { direction: "c2s", handler: "lib/project-logs.js", description: "List or search this project's logs (project scope is bound server-side)" },
  "project_log_read":         { direction: "c2s", handler: "lib/project-logs.js", description: "Read one project log entry by opaque ref" },
  "project_log_comment":      { direction: "c2s", handler: "lib/project-logs.js", description: "Append an attributed comment to a project log entry (append-only; author comes from the connection)" },
  "project_log_delete":       { direction: "c2s", handler: "lib/project-logs.js", description: "Delete a project log entry (project owner only; scope and identity are bound server-side)" },
  "project_log_create":       { direction: "c2s", handler: "lib/project-logs.js", description: "Retired. Canonical entries are written only by project agent sessions; this is always refused" },
  "project_log_update":       { direction: "c2s", handler: "lib/project-logs.js", description: "Retired. Canonical revisions are written only by project agent sessions; this is always refused" },
  "project_logs_state":       { direction: "s2c", handler: "lib/public/modules/project-logs.js", description: "Correlated project log index for a list or search request" },
  "project_log_entry":        { direction: "s2c", handler: "lib/public/modules/project-logs.js", description: "Correlated full project log entry" },
  "project_log_commented":    { direction: "s2c", handler: "lib/public/modules/project-logs.js", description: "Correlated project log entry after a comment was appended" },
  "project_log_comment_reviewed": { direction: "s2c", handler: "lib/public/modules/project-logs.js", description: "A Project Driver resolved a log comment; carries identifiers and action only" },
  "project_log_deleted":      { direction: "s2c", handler: "lib/public/modules/project-logs.js", description: "Confirm that the project owner deleted a project log entry" },
  "project_log_updated":      { direction: "s2c", handler: "lib/public/modules/project-logs.js", description: "A project log entry was created, revised, or deleted (bounded ledger metadata only)" },
  "project_logs_error":       { direction: "s2c", handler: "lib/public/modules/project-logs.js", description: "Correlated project log request failure" },

  // -----------------------------------------------------------------------
  // Browser extension
  // -----------------------------------------------------------------------
  "browser_tab_list":         { direction: "c2s", handler: "lib/project-user-message.js", description: "Provide browser tab list from the extension" },
  "extension_result":         { direction: "c2s", handler: "lib/project-user-message.js", description: "Result from a browser extension command" },
  "extension_command":        { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Command for the browser extension to execute" },
  "clay_ext_tab_list":        { direction: "s2c", handler: "lib/public/modules/app-misc.js", description: "Browser tab list from the extension (broadcast)" },
  "clay_ext_result":          { direction: "s2c", handler: "lib/public/modules/app-misc.js", description: "Browser extension command result (broadcast)" },
  "clay_ext_command":         { direction: "c2s", handler: "lib/public/modules/app-misc.js", description: "Send a command to the browser extension" },

  // -----------------------------------------------------------------------
  // MCP Bridge (remote MCP servers via Chrome Extension)
  // -----------------------------------------------------------------------
  "mcp_servers_available":    { direction: "c2s", handler: "lib/project-mcp.js", description: "Report available MCP servers from Chrome Extension" },
  "mcp_tool_call":            { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Forward MCP tool call to extension or HTTP endpoint" },
  "mcp_tool_result":          { direction: "c2s", handler: "lib/project-mcp.js", description: "Return MCP tool result from extension" },
  "mcp_tool_error":           { direction: "c2s", handler: "lib/project-mcp.js", description: "Return MCP tool error from extension" },
  "mcp_toggle_server":        { direction: "c2s", handler: "lib/project-mcp.js", description: "Toggle MCP server enabled state for this project" },
  "mcp_servers_state":        { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Broadcast MCP server list and enabled state to clients" },

  // -----------------------------------------------------------------------
  // Skills
  // -----------------------------------------------------------------------
  "skill_installed":          { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Skill was installed" },
  "skill_uninstalled":        { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Skill was uninstalled" },

  // -----------------------------------------------------------------------
  // DMs (direct messages)
  // -----------------------------------------------------------------------
  "dm_list":                  { direction: "both", handler: "lib/server-dm.js", description: "Request (c2s) or receive (s2c) DM conversation list" },
  "dm_open":                  { direction: "c2s", handler: "lib/server-dm.js", description: "Open a DM conversation with a user/mate" },
  "dm_history":               { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "DM conversation history" },
  "dm_send":                  { direction: "c2s", handler: "lib/server-dm.js", description: "Send a DM message" },
  "dm_message":               { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Incoming DM message" },
  "dm_typing":                { direction: "both", handler: "lib/server-dm.js", description: "DM typing indicator" },
  "dm_add_favorite":          { direction: "c2s", handler: "lib/server-dm.js", description: "Add a mate to DM favorites" },
  "dm_remove_favorite":       { direction: "c2s", handler: "lib/server-dm.js", description: "Remove a mate from DM favorites" },
  "dm_favorites_updated":     { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "DM favorites list updated" },
  "set_mate_dm":              { direction: "c2s", handler: "lib/project-sessions.js", description: "Set active mate for DM mode in a session" },
  "restore_mate_dm":          { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Restore mate DM mode on reconnect" },

  // -----------------------------------------------------------------------
  // Mates (AI personas)
  // -----------------------------------------------------------------------
  "mate_create":              { direction: "c2s", handler: "lib/server-mates.js", description: "Create a new mate" },
  "mate_created":             { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Mate was created" },
  "mate_list":                { direction: "both", handler: "lib/server-mates.js", description: "Request (c2s) or receive (s2c) mate list" },
  "mate_delete":              { direction: "c2s", handler: "lib/server-mates.js", description: "Delete a mate" },
  "mate_deleted":             { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Mate was deleted" },
  "mate_update":              { direction: "c2s", handler: "lib/server-mates.js", description: "Update a mate's properties" },
  "mate_updated":             { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Mate was updated" },
  "mate_readd_builtin":       { direction: "c2s", handler: "lib/server-mates.js", description: "Re-add a previously deleted built-in mate" },
  "mate_list_available_builtins": { direction: "c2s", handler: "lib/server-mates.js", description: "List built-in mates available for re-adding" },
  "mate_available_builtins":  { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Available built-in mates list" },
  "mate_error":               { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Mate operation error" },

  // -----------------------------------------------------------------------
  // User-installed home tools
  // -----------------------------------------------------------------------
  "tools_list":               { direction: "c2s", handler: "lib/server-tools.js", description: "List installed tool definitions" },
  "tool_get":                 { direction: "c2s", handler: "lib/server-tools.js", description: "Get one installed tool definition" },
  "tool_install":             { direction: "c2s", handler: "lib/server-tools.js", description: "Install a new declarative tool" },
  "tool_source_get":          { direction: "c2s", handler: "lib/server-tools.js", description: "Read authored Capsule source for the current user" },
  "tool_mate_access_set":     { direction: "c2s", handler: "lib/server-tools.js", description: "Set whether Mates may inspect and edit one Capsule" },
  "tool_remove":              { direction: "c2s", handler: "lib/server-tools.js", description: "Remove an installed tool" },
  "tool_storage_op":          { direction: "c2s", handler: "lib/server-tools.js", description: "Run an operation against scoped tool storage" },
  "tool_llm_op":              { direction: "c2s", handler: "lib/server-tools.js", description: "Run a permission-gated vendor-neutral capsule LLM completion" },
  "tool_llm_config_get":      { direction: "c2s", handler: "lib/server-tools.js", description: "Get the concrete configured provider and model used by Capsule LLM calls" },
  "tool_control_response":    { direction: "c2s", handler: "lib/server-tools.js", description: "Resolve a mate tool-control request with browser runtime state or an error" },
  "tool_server_control":      { direction: "c2s", handler: "lib/server-tools.js", description: "Human snapshot or action against a server-runtime Capsule, through the same Logic a Mate calls" },
  "tool_frame_url":           { direction: "c2s", handler: "lib/server-tools.js", description: "Mint a one-time separate-origin URL for a Capsule's sandboxed rich Display frame" },
  "tools_state":              { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Full installed tool definitions" },
  "tool_installed":           { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "An installed tool changed" },
  "tool_source_state":        { direction: "s2c", handler: "lib/public/modules/home-capsule-source.js", description: "Correlated authored Capsule source or read error" },
  "tool_mate_access_state":   { direction: "s2c", handler: "lib/public/modules/home-capsule-source.js", description: "Server-confirmed Mate editing permission" },
  "tool_removed":             { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "An installed tool was removed" },
  "tool_storage_result":      { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Result of a scoped tool storage operation" },
  "tool_llm_result":          { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Result of a capsule LLM completion" },
  "tool_llm_config_state":    { direction: "s2c", handler: "lib/public/modules/tool-llm-status.js", description: "Concrete provider and model state for Capsule LLM calls" },
  "tool_control_request":     { direction: "s2c", handler: "lib/public/modules/home-tools.js", description: "Ask the connected home client to snapshot or drive a sandboxed tool" },
  "tool_server_state":        { direction: "s2c", handler: "lib/public/modules/home-tools.js", description: "Correlated server-runtime Capsule state for the human who requested it, or the refusal that blocked it" },
  "tool_server_event":        { direction: "s2c", handler: "lib/public/modules/home-tools.js", description: "Ordered causal act event {seq, actor, action, previous, next} pushed to the user's Displays whenever server-runtime Capsule Logic changes state" },
  "tool_frame_url_state":     { direction: "s2c", handler: "lib/public/modules/home-tool-frame.js", description: "Correlated one-time rich Display frame URL, or the refusal that blocked it" },
  "capsule_game_session":     { direction: "s2c", handler: "lib/public/modules/home-tools.js", description: "A Capsule game session opened or advanced for this user; an explicit game start navigates the home board into it" },
  "tools_error":              { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Tool registry, runtime, or storage error" },

  // -----------------------------------------------------------------------
  // Mentions (@mate)
  // -----------------------------------------------------------------------
  "mention":                  { direction: "c2s", handler: "lib/project.js", description: "Mention a mate in the conversation" },
  "mention_stop":             { direction: "c2s", handler: "lib/project.js", description: "Stop a running mention" },
  "mention_processing":       { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Mention processing state changed" },
  "mention_start":            { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Mention response started" },
  "mention_activity":         { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Mention activity indicator" },
  "mention_stream":           { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Incremental mention response text" },
  "mention_done":             { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Mention response complete" },
  "mention_error":            { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Mention processing error" },
  "mention_user":             { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Echo of user's mention message in timeline" },
  "mention_response":         { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Full mention response entry in timeline" },

  // -----------------------------------------------------------------------
  // Debate
  // -----------------------------------------------------------------------
  "debate_start":             { direction: "c2s", handler: "lib/project.js", description: "Start a new debate" },
  "debate_hand_raise":        { direction: "c2s", handler: "lib/project.js", description: "Raise hand during a debate" },
  "debate_comment":           { direction: "c2s", handler: "lib/project.js", description: "Submit a comment during a debate" },
  "debate_stop":              { direction: "c2s", handler: "lib/project.js", description: "Stop the current debate" },
  "debate_conclude_response": { direction: "c2s", handler: "lib/project.js", description: "Respond to a debate conclude prompt (end or continue)" },
  "debate_confirm_brief":     { direction: "c2s", handler: "lib/project.js", description: "Confirm the debate brief and start the debate" },
  "debate_proposal_response": { direction: "c2s", handler: "lib/project.js", description: "Respond to a debate proposal with optional per-participant model overrides" },
  "debate_user_floor_response": { direction: "c2s", handler: "lib/project.js", description: "User submits their statement during user floor turn" },
  "debate_preparing":         { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Debate is being prepared" },
  "debate_brief_ready":       { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Debate brief is ready for user approval" },
  "debate_started":           { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Debate has started" },
  "debate_turn":              { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "A new debate turn is starting" },
  "debate_activity":          { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Debate panelist activity indicator" },
  "debate_stream":            { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Incremental debate response text" },
  "debate_turn_done":         { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Debate turn completed with full text" },
  "debate_tool_decision":     { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Moderator tool permission decision for a debate participant" },
  "debate_stop_requested":    { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Debate will stop after the active turn" },
  "debate_stop_cancelled":    { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Pending debate stop was cancelled" },
  "debate_hand_raised":       { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "User hand raise was acknowledged" },
  "debate_comment_queued":    { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "User comment was queued for injection" },
  "debate_comment_injected":  { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "User comment was injected into the debate" },
  "debate_conclude_confirm":  { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Moderator wants to conclude, asking for confirmation" },
  "debate_user_floor":        { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "User has the floor to speak" },
  "debate_user_floor_done":   { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "User floor turn ended" },
  "debate_user_resume":       { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "User resumed debate with instruction" },
  "debate_resumed":           { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Debate resumed after user floor" },
  "debate_ended":             { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Debate has ended" },
  "debate_error":             { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Debate error" },

  // -----------------------------------------------------------------------
  // Knowledge (mate knowledge files)
  // -----------------------------------------------------------------------
  "knowledge_list":           { direction: "both", handler: "lib/project-knowledge.js", description: "Request (c2s) or receive (s2c) knowledge file list" },
  "knowledge_read":           { direction: "c2s", handler: "lib/project-knowledge.js", description: "Read a knowledge file" },
  "knowledge_content":        { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Knowledge file content" },
  "knowledge_save":           { direction: "c2s", handler: "lib/project-knowledge.js", description: "Save a knowledge file" },
  "knowledge_saved":          { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Knowledge file was saved" },
  "knowledge_delete":         { direction: "c2s", handler: "lib/project-knowledge.js", description: "Delete a knowledge file" },
  "knowledge_deleted":        { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Knowledge file was deleted" },
  "knowledge_promote":        { direction: "c2s", handler: "lib/project-knowledge.js", description: "Promote a knowledge file to always-active" },
  "knowledge_promoted":       { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Knowledge file was promoted" },
  "knowledge_depromote":      { direction: "c2s", handler: "lib/project-knowledge.js", description: "Depromote a knowledge file from always-active" },
  "knowledge_depromoted":     { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Knowledge file was depromoted" },

  // -----------------------------------------------------------------------
  // Memory (mate memory)
  // -----------------------------------------------------------------------
  "memory_list":              { direction: "both", handler: "lib/project.js", description: "Request (c2s) or receive (s2c) memory entries" },
  "memory_search":            { direction: "c2s", handler: "lib/project.js", description: "Search memory entries" },
  "memory_search_results":    { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Memory search results" },
  "memory_delete":            { direction: "c2s", handler: "lib/project.js", description: "Delete a memory entry by index" },
  "memory_deleted":           { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Memory entry was deleted" },

  // -----------------------------------------------------------------------
  // Loop (automated task runner)
  // -----------------------------------------------------------------------
  "loop_start":               { direction: "c2s", handler: "lib/project-loop.js", description: "Start the loop runner" },
  "loop_stop":                { direction: "c2s", handler: "lib/project-loop.js", description: "Stop the running loop" },
  "loop_available":           { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Loop configuration is available" },
  "loop_started":             { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Loop has started running" },
  "loop_iteration":           { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Loop iteration progress update" },
  "loop_judging":             { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Loop is running the judge step" },
  "loop_verdict":             { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Judge verdict for a loop iteration" },
  "loop_stopping":            { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Loop is in the process of stopping" },
  "loop_finished":            { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Loop has finished" },
  "loop_error":               { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Loop error" },
  "loop_scheduled":           { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Loop was scheduled via cron" },
  "loop_rerun_started":       { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "A loop registry entry re-run has started" },

  // -----------------------------------------------------------------------
  // Loop registry (task schedule management)
  // -----------------------------------------------------------------------
  "loop_registry_list":       { direction: "c2s", handler: "lib/project-loop.js", description: "Request the loop registry list" },
  "loop_registry_update":     { direction: "c2s", handler: "lib/project-loop.js", description: "Update a loop registry entry" },
  "loop_registry_rename":     { direction: "c2s", handler: "lib/project-loop.js", description: "Rename a loop registry entry" },
  "loop_registry_remove":     { direction: "c2s", handler: "lib/project-loop.js", description: "Remove a loop registry entry" },
  "loop_registry_convert":    { direction: "c2s", handler: "lib/project-loop.js", description: "Convert a loop registry entry type" },
  "loop_registry_toggle":     { direction: "c2s", handler: "lib/project-loop.js", description: "Toggle a loop registry entry on/off" },
  "loop_registry_rerun":      { direction: "c2s", handler: "lib/project-loop.js", description: "Re-run a loop registry entry" },
  "loop_registry_files":      { direction: "c2s", handler: "lib/project-loop.js", description: "Request loop registry file contents (PROMPT.md / JUDGE.md)" },
  "loop_registry_files_content": { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Loop registry file contents" },
  "loop_registry_updated":    { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Broadcast: loop registry was updated" },
  "loop_registry_error":      { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Loop registry operation error" },
  "delete_loop_group":        { direction: "c2s", handler: "lib/project-loop.js", description: "Delete all sessions for a loop group" },

  // -----------------------------------------------------------------------
  // Schedules (hub-level)
  // -----------------------------------------------------------------------
  "schedule_create":          { direction: "c2s", handler: "lib/project-loop.js", description: "Create a new schedule" },
  "hub_schedules_list":       { direction: "c2s", handler: "lib/project-loop.js", description: "Request the hub schedules list" },
  "hub_schedules":            { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Hub schedules list" },
  "schedule_run_started":     { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "A scheduled run has started" },
  "schedule_run_finished":    { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "A scheduled run has finished" },

  // -----------------------------------------------------------------------
  // Ralph (loop wizard / crafting)
  // -----------------------------------------------------------------------
  "ralph_wizard_complete":    { direction: "c2s", handler: "lib/project-loop.js", description: "Submit completed wizard data" },
  "ralph_wizard_cancel":      { direction: "c2s", handler: "lib/project-loop.js", description: "Cancel the wizard" },
  "ralph_preview_files":      { direction: "c2s", handler: "lib/project-loop.js", description: "Request preview of loop files" },
  "ralph_cancel_crafting":    { direction: "c2s", handler: "lib/project-loop.js", description: "Cancel file crafting in progress" },
  "ralph_phase":              { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Current ralph wizard phase" },
  "ralph_crafting_started":   { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "File crafting session started" },
  "ralph_files_status":       { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Prompt/judge file readiness status" },
  "ralph_files_content":      { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Loop file contents (prompt and judge)" },

  // -----------------------------------------------------------------------
  // Embedded mate chat
  // -----------------------------------------------------------------------
  "home_mate_open":           { direction: "c2s", handler: "lib/server-home-chat.js", description: "Open or restore the selected mate's embedded chat session" },
  "home_clay_ask":            { direction: "c2s", handler: "lib/server-home-chat.js", description: "Start a fresh builtin Clay conversation from the global search drawer" },
  "home_mate_sessions_list":  { direction: "c2s", handler: "lib/server-home-chat.js", description: "List the current user's conversations with the selected mate" },
  "home_mate_session_open":   { direction: "c2s", handler: "lib/server-home-chat.js", description: "Open one explicit conversation with the selected mate" },
  "home_mate_send":           { direction: "c2s", handler: "lib/server-home-chat.js", description: "Send a message to the selected mate from the home hub" },
  "home_mate_stop":           { direction: "c2s", handler: "lib/server-home-chat.js", description: "Stop the exact query-bound global Ask Clay turn" },
  "home_mate_permission_response": { direction: "c2s", handler: "lib/server-home-chat.js", description: "Answer an exact pending global Ask Clay permission request" },
  "home_mate_new_session":    { direction: "c2s", handler: "lib/server-home-chat.js", description: "Start a fresh embedded session with the selected mate, optionally with a typed creation intent" },
  "home_mate_debate_plan":    { direction: "c2s", handler: "lib/server-home-chat.js", description: "Start a fresh server-seeded debate planning conversation with Clay using an optional prefilled topic" },
  "home_mate_creation_plan":  { direction: "c2s", handler: "lib/server-home-chat.js", description: "Start a fresh server-seeded Mate creation interview with Clay" },
  "home_mate_creation_question_response": { direction: "c2s", handler: "lib/server-home-chat.js", description: "Answer an exact pending question in a Clay-led Mate creation interview" },
  "home_mate_creation_proposal_response": { direction: "c2s", handler: "lib/server-home-chat.js", description: "Approve or cancel an exact Mate creation proposal" },
  "home_debate_proposal_response": { direction: "c2s", handler: "lib/server-home-chat.js", description: "Approve or cancel an exact Home debate proposal with optional per-participant model overrides" },
  "home_debate_question_response": { direction: "c2s", handler: "lib/server-home-chat.js", description: "Answer the exact pending AskUserQuestion in an owned Home debate planning session" },
  "home_debate_control":      { direction: "c2s", handler: "lib/server-home-chat.js", description: "Control or resume the exact owned Home debate session" },
  "home_mate_close":          { direction: "c2s", handler: "lib/server-home-chat.js", description: "Tear down the embedded mate session tap" },
  "home_mate_present":        { direction: "c2s", handler: "lib/server-home-chat.js", description: "Report whether Home is visibly presenting its active exact Mate conversation" },
  "home_mate_memory_list":    { direction: "c2s", handler: "lib/server-home-chat.js", description: "Request a correlated read-only memory projection for one owned Mate" },
  "home_mate_knowledge_list": { direction: "c2s", handler: "lib/server-home-chat.js", description: "Request a correlated read-only knowledge file list for one owned Mate" },
  "home_mate_models_get":     { direction: "c2s", handler: "lib/server-home-chat.js", description: "Request an available vendor and model catalog for the selected Mate" },
  "home_mate_model_set":      { direction: "c2s", handler: "lib/server-home-chat.js", description: "Validate and persist the Mate vendor/model, optionally applying it to an exact owned pristine Home draft" },
  "home_mate_history":        { direction: "s2c", handler: "lib/public/modules/home-mate-chat.js", description: "Selected mate's initial or refreshed chat history" },
  "home_clay_activity":       { direction: "s2c", handler: "lib/public/modules/search-clay-chat.js", description: "Sanitized progress stage for a query-bound global-search Clay conversation" },
  "home_mate_permission_request": { direction: "s2c", handler: "lib/public/modules/search-clay-chat.js", description: "Exact pending permission card for a global Ask Clay conversation" },
  "home_mate_permission_resolved": { direction: "s2c", handler: "lib/public/modules/search-clay-chat.js", description: "Server-confirmed Ask Clay permission decision" },
  "home_mate_permission_cancelled": { direction: "s2c", handler: "lib/public/modules/search-clay-chat.js", description: "Server-confirmed Ask Clay permission cancellation" },
  "home_mate_stopping":       { direction: "s2c", handler: "lib/public/modules/search-clay-chat.js", description: "Server accepted Stop for the exact Ask Clay conversation" },
  "home_mate_session_identity": { direction: "s2c", handler: "lib/public/modules/app-message-router.js", description: "Promote an active Home session from its local reference to its durable runtime identity" },
  "home_mate_sessions_state": { direction: "s2c", handler: "lib/public/modules/home-mate-chat.js", description: "Owned visible Mate conversations with sanitized runtime identity, model, status, and timestamps" },
  "home_mate_delta":          { direction: "s2c", handler: "lib/public/modules/home-mate-chat.js", description: "Selected mate's streaming assistant text delta" },
  "home_mate_segment":        { direction: "s2c", handler: "lib/public/modules/home-mate-chat.js", description: "A tool call ended the mate's current spoken burst; the client seals the streamed bubble and later text starts a fresh one" },
  "home_mate_done":           { direction: "s2c", handler: "lib/public/modules/home-mate-chat.js", description: "Selected mate's turn finished" },
  "home_debate_proposal":     { direction: "s2c", handler: "lib/public/modules/app-message-router.js", description: "Session-bound debate proposal for the active Home transcript" },
  "home_debate_proposal_resolved": { direction: "s2c", handler: "lib/public/modules/app-message-router.js", description: "Server-confirmed result for a Home debate proposal" },
  "home_debate_question":     { direction: "s2c", handler: "lib/public/modules/app-message-router.js", description: "Session-bound AskUserQuestion card for Home debate planning" },
  "home_debate_question_resolved": { direction: "s2c", handler: "lib/public/modules/app-message-router.js", description: "Server-confirmed answer or expiry for a Home debate question" },
  "home_debate_event":       { direction: "s2c", handler: "lib/public/modules/app-message-router.js", description: "Correlated live debate event for the active Home transcript" },
  "home_mate_creation_question": { direction: "s2c", handler: "lib/public/modules/app-message-router.js", description: "Session-bound question in a Clay-led Mate creation interview" },
  "home_mate_creation_question_resolved": { direction: "s2c", handler: "lib/public/modules/app-message-router.js", description: "Server-confirmed Mate interview answer or expiry" },
  "home_mate_creation_proposal": { direction: "s2c", handler: "lib/public/modules/app-message-router.js", description: "Session-bound new Mate proposal" },
  "home_mate_creation_proposal_resolved": { direction: "s2c", handler: "lib/public/modules/app-message-router.js", description: "Server-confirmed result for a Mate creation proposal" },
  "home_mate_error":          { direction: "s2c", handler: "lib/public/modules/home-mate-chat.js", description: "Embedded mate chat error" },
  "home_mate_memory_state":   { direction: "s2c", handler: "lib/public/modules/home-mate-settings.js", description: "Selected mate's read-only memory summary and entries" },
  "home_mate_knowledge_state": { direction: "s2c", handler: "lib/public/modules/home-mate-settings.js", description: "Selected mate's read-only knowledge file list" },
  "home_mate_models_state":   { direction: "s2c", handler: "lib/public/modules/home-mate-settings.js", description: "Correlated Mate model catalog state" },
  "home_mate_model_result":   { direction: "s2c", handler: "lib/public/modules/home-mate-settings.js", description: "Correlated Mate model selection result" }
};

module.exports = { schema: schema };
