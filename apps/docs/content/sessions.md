# Sessions

Sessions keep a project's conversations available across visits. Each has its own task history, provider choices, draft, and visibility. A session can remain available after a turn finishes or its pane closes.

## Begin or return

Choose a project, select **New session**, choose an installed provider, and select **Create**. Send a bounded request and inspect the response and relevant tool results.

To return, select the session from its folder or find it through search. Wait for history to load, then review the latest outcome before asking it to continue. Files may have changed since its previous turn.

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

Closing a pane changes presentation. Stop interrupts execution. Deleting a session is a separate removal operation. Before retrying after disconnection, inspect both transcript and pending queue so a missed acknowledgement does not cause duplicate work.

Several sessions in one directory can change the same files. Use [worktrees](/docs/worktree-sharing) for independent branches and [Drivers/Workers](/docs/drivers-workers) for bounded delegated execution.

For model availability and runtime-specific limits, read [Provider capabilities](/docs/provider-capabilities).
