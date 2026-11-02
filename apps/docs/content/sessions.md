# Sessions

Sessions keep a project's conversations available across visits. Each has its own task history, provider choices, draft, and visibility. A session can remain available after a turn finishes or its pane closes.

## Begin or return

Choose a project, select **New session**, choose an installed provider, and select **Create**. Send a bounded request and inspect the response and relevant tool results.

When you enter a project or refresh it, Clay Studio first returns to your last visited session if it is still working or stopped less than 24 hours ago. That recent session takes priority even when another session is running. Otherwise, it opens the running session you visited most recently. If none qualifies, the workspace shows the session picker without creating a session.

The 24 hours starts when work stops. Reading an old conversation does not restart the clock. Active turns, requests waiting for your approval or answer, submitted work, and running user background tasks count as work, including work in the session's owned Workers. Paused messages waiting to be sent and idle provider processes do not. Your last 100 distinct session visits are saved for your account and project across browsers and devices. Opening a specific session from the sidebar or a link always takes precedence, and an open conversation stays in place as time passes.

For older sessions without a saved stop time, Clay Studio uses their last timestamped completion, then their known creation time. If neither is known, stopped work is not treated as recent. Running sessions without a saved visit order use a stable order until you visit them.

To return, select the session from its folder or find it through search. Wait for history to load, then review the latest outcome before asking it to continue. Files may have changed since its previous turn.

Choose **Close** at the far right of a pane header to remove it from the current workspace, even when it is the only pane. Closing does not stop execution or delete the session. When the last pane closes, the workspace shows a compact session picker. Search sessions or choose a recent session to open it; under **New session**, select an installed provider to create a session. Press **Escape** to dismiss the picker, or use the sidebar to open or create sessions.

Start with [Create, resume, and rename](/docs/session-lifecycle) for the full procedure.

## Common session tasks

- [History and search](/docs/session-history-search): find earlier messages and decisions.
- [Fork and rewind](/docs/session-fork-rewind): explore another path or inspect a supported checkpoint.
- [Settings and handoffs](/docs/session-settings): change supported settings and continue elsewhere.
- [Privacy and sharing](/docs/session-privacy-sharing): check who can see the conversation.
- [Composer basics](/docs/composer-basics): send requests and interpret Send/Stop behavior.
- [Drafts and queue](/docs/drafts-and-queue): edit and reorder pending work.
- [Split Views](/docs/split-views): arrange several conversations without merging them.

## Keep execution distinct

Closing a pane changes presentation and leaves the session, history, and running activity intact. Stop interrupts execution. Deleting a session is separate. Before retrying after disconnection, inspect both transcript and pending queue so a missed acknowledgement does not cause duplicate work.

Several sessions in one directory can change the same files. Use [worktrees](/docs/worktree-sharing) for independent branches and [Drivers and Workers](/docs/drivers-workers) for delegated tasks.

For model availability and runtime-specific limits, read [Provider capabilities](/docs/provider-capabilities).

GitHub session links use the server GitHub CLI credential environment. You can inspect and explicitly associate that account through [Personal Integrations](/docs/github). Disconnecting the saved association retains existing session links and CLI credentials.
