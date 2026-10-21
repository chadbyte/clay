# Provider capabilities and interfaces

Clay Studio provides a common workspace for different coding agents while preserving differences in models, tools, history, and execution modes. The active session's controls show what is currently usable.

## Know the interface

| Interface | Purpose |
| --- | --- |
| GUI session | Clay Studio transcript, composer, permission cards, and tool rendering |
| TUI session | The coding agent's interactive terminal interface |
| CLI | Direct shell commands, including installation and login |
| SDK or protocol | Clay Studio's integration with the runtime |

A provider having a CLI does not imply it offers a Clay Studio TUI session. The current registry offers Claude Code GUI and TUI modes; other listed runtimes expose GUI sessions. Availability also depends on the installed version and live runtime.

## Check before relying on a feature

1. Open the intended session.
2. Load its model catalog.
3. Check offered effort levels.
4. Inspect permission choices and any effective-mode status.
5. Look for the actual control for a provider-specific feature.

**Auto** permission mode is conditional. A session can report that Auto is unavailable at runtime and show the mode actually used. Support in one provider does not establish support in another.

[Background task conversations](/docs/background-task-conversations) are conditional too. Clay Studio only displays tasks it can correlate with the session and runtime. A provider's internal task identifier is not automatically a writable Clay Studio conversation.

## Continuity and limits

Directories, supported instruction files, Clay Studio records, and visible handoff summaries help work continue across providers. Hidden reasoning, native task handles, exact usage accounting, and tool transport are not universally interchangeable.

Claude Code and Codex have provider usage dashboard links. Other runtimes can have no integrated quota tracking. Missing usage means unavailable information, not zero usage.

Custom Clay Studio tools depend on runtime transport and session authorization. Ordinary coding can work while a particular Clay Studio operation remains unavailable. Canonical Clay has additional owner-scoped controls; ordinary Mates do not receive all of them.

## If a feature is absent

Use a supported visible path, choose another authorized provider if appropriate, or describe the missing capability in a handoff. Before retrying an external action through another interface, inspect whether the first attempt took effect.

See [Models](/docs/models-and-providers), [Session settings and handoffs](/docs/session-settings), and [Clay Studio, Clay, and other Mates](/docs/clay-vs-mates).
