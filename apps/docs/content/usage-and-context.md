# Usage and context

**Usage** tells you about provider consumption and account limits. **Context** is the material a model can use for its current response. For example, a long transcript may need summarizing even when your account still has plenty of usage available.

## Read the usage overview

Open the usage overview in the top bar to see entries for all supported vendors. Read each entry's status and measurement time: it may contain an account reading, a report from one of your sessions, or an unavailable/not-integrated explanation.

Clay Studio has account-reading integrations for Claude Code, Codex, Muse Code, Kimi Code, Grok Build, and Kiro CLI. A reading still depends on the installed version, sign-in, and whether Clay Studio can associate it with your account. Some readers are limited to single-user installations. Other vendors can be listed without an integrated account reading.

External dashboard links are separate: Claude Code and Codex provide links to their own usage pages. An absent dashboard link does not mean the overview has no usage information for that vendor.

1. Select the vendor you want to inspect.
2. Read the status, time, and measurement units.
3. Check reset information when supplied.
4. Use an available provider dashboard for further account detail.

A session token count covers that session's reported activity, not necessarily the whole account. Tokens are pieces of text used to measure model input and output; they are not a currency. Unavailable values are unknown, not zero, and reported figures may not match an invoice.

## Keep useful context available

Messages, tool output, pasted text, and attachments all take up context. A model has a limit on how much it can use at once. Longer conversations may be summarized to make room, so an exact earlier quote may no longer be in its immediate context even though it remains in [history](/docs/session-history-search).

Refer to current repository paths when the agent should read live files. For a long investigation, ask for a handoff containing the goal, decisions, changes, checks, and next step. For example: “Use the current files as truth. The earlier summary explains the decision; inspect the implementation before changing it.”

## When a limit interrupts work

Read the provider notice and check the pending queue before sending again. You can wait for the reported reset or [continue with another provider](/docs/session-settings) that has access. Include unfinished work and unverified results in the handoff.

Stop does not refund usage already incurred. Parallel Workers and background tasks can consume resources in addition to the main conversation.
