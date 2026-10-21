# Usage and context

Usage describes provider-reported consumption or limits. Context describes information available to the current model turn. These are related but are not interchangeable meters.

## Inspect usage

Look at the session's available usage indicators and the provider usage controls. Claude Code and Codex expose links to their provider dashboards. Other runtimes may offer less information or no integrated quota display.

1. Confirm the active provider and model.
2. Open available usage details.
3. Check the measurement's scope and freshness.
4. Read rate-limit or reset information when supplied.
5. Use the provider dashboard for account-level detail.

A session token total is not necessarily your entire account's usage. A missing value is unavailable information, not zero consumption. Cached, partial, and provider-reported figures should not be treated as an exact invoice.

## Manage context

Long conversations, tool output, pasted text, and attachments all affect the material available for a task. A model's context limit is different from a provider's account usage limit.

Keep requests focused. Refer to current repository paths for files the agent should inspect rather than repeatedly pasting large copies. For a long investigation, ask for a concise handoff covering the goal, decisions, changes, checks, and next step.

A useful continuation is: “Use the current files as truth. The earlier summary explains the decision, but inspect the implementation before changing it.”

Runtime compaction or summarization can preserve continuity without keeping every original detail immediately available. If an exact earlier quote or tool result matters, locate it in [history](/docs/session-history-search).

## Handle rate limits

Read the actual provider notice. A limit can pause or fail work even though the Clay Studio connection remains healthy. Do not repeatedly submit the same message; inspect the queue and any scheduled retry state first.

You can wait for the reported reset, choose another entitled model/provider, or reduce the task. A [handoff](/docs/session-settings) should preserve unfinished work and acknowledge any unverified result.

Stopping prevents further intended work but does not refund consumption already incurred. Several parallel Workers or background tasks can also consume provider resources independently of the visible main response.

See [Models](/docs/models-and-providers), [Provider capabilities](/docs/provider-capabilities), and [Drafts and queue](/docs/drafts-and-queue).
