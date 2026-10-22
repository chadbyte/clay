# Glossary

Follow a term's link for examples and instructions.

## Workspace and collaborators

| Term | Meaning |
| --- | --- |
| **[Clay Studio](/docs/getting-started)** | The application and server that provide your workspace |
| **[Clay](/docs/clay-vs-mates)** | Your built-in lead Mate, who helps coordinate work and operates supported workspace controls |
| **[Mate](/docs/mate-creation-identity)** | A private AI collaborator with a continuing role, instructions, and conversations |
| **[Project](/docs/projects-working-directories)** | A folder on the server, with conversations and records for the work there |
| **[Session](/docs/session-lifecycle)** | A conversation you can return to across visits |
| **[Provider runtime](/docs/models-and-providers)** | The coding-agent application Clay Studio uses, such as Claude Code or Codex |
| **[Model](/docs/models-and-providers)** | The AI model selected through that coding agent |
| **[Driver](/docs/drivers-workers)** | The project agent responsible for the task and reviewing its result |
| **[Split Worker](/docs/drivers-workers)** | A linked agent session assigned part of the Driver's work |
| **[Background task](/docs/background-task-conversations)** | A task started within a provider's execution, with provider-dependent inspection controls |

## Layout and files

| Term | Meaning |
| --- | --- |
| **[View](/docs/split-views)** | A saved project arrangement of conversations and tool panes |
| **[Folder](/docs/navigation)** | Organization for session-list entries; it does not move repository files |
| **[Worktree](/docs/worktree-sharing)** | A separate Git working directory for parallel changes |
| **[Overlay / Dock](/docs/workbench-layout)** | A tool floating over the conversation / space reserved beside it |
| **[Follow / Pin](/docs/files)** | A file pane following your selection / keeping one file visible |
| **[GUI / TUI](/docs/provider-capabilities)** | A graphical conversation / a coding agent's terminal interface |
| **[CLI](/docs/cli-flags)** | A program you operate through typed terminal commands |

## Lasting context

**[Knowledge](/docs/knowledge-documents)** holds documents and databases in Mate workspaces. A database **schema** defines its fields; a saved table **view** chooses columns, filters, and ordering without copying its records.

**[Project Logs](/docs/project-logs)** preserve task outcomes and decisions. **[Issues](/docs/issues)** track actionable work. **[Notes](/docs/notes)** keep reminders visible while they need attention.

**[Me](/docs/mate-knowledge-memory-me)** holds private knowledge about you across projects and Mates. Clay reviews reported observations before saving them. **Mate Memory** refers to that Mate's recorded conversation material and is separate from Me.

## Messages and automation

A **[draft](/docs/drafts-and-queue)** is unsent text. A **queued** message is waiting for delivery. Delivery or acknowledgement means it reached the receiving system; completion means the requested work finished.

A **[delayed message](/docs/delayed-messages)** sends once after a delay. A **[Mate schedule](/docs/mate-schedules)** sends a private recurring prompt. A **[Scheduled Task](/docs/scheduled-tasks)** runs a project Driver/Worker pair. **[Loop/Ralph](/docs/loops-and-ralph)** supports repeated attempts toward a defined outcome.

**[Skip](/docs/automation-overlap)** omits an overlapping start; **coalescing** combines overlapping starts into one queued follow-up. **Pause** changes future scheduling. **[Stop](/docs/stop-recovery)** interrupts execution without undoing actions already completed.

## Access

A **[public project](/docs/project-sharing)** is available under authenticated workspace rules, not anonymously published. **Exact access** grants access to one worktree; **inherited access** comes from its parent project. A session has its own [visibility](/docs/session-privacy-sharing) in addition to project access.

**[Permission mode](/docs/permissions)** controls how the agent handles tool actions. It does not grant access to another person's private content.
