# Glossary

Use these terms to distinguish presentation, execution, access, and recorded outcomes.

| Term | Meaning |
| --- | --- |
| **Clay Studio** | The product, application, workspace, and server |
| **Clay** | The lead Mate's name; not an abbreviation for Clay Studio |
| **Project** | A registered server directory and its associated workspace context |
| **Session** | A durable conversation with a provider runtime |
| **Provider runtime** | The coding-agent application Clay Studio uses |
| **Model** | A model offered through that runtime |
| **GUI / TUI** | Clay Studio's graphical conversation / a provider's terminal interface |
| **Driver** | The project agent responsible for the user's outcome and review |
| **Split Worker** | A bounded delegated execution session linked to its Driver |
| **Background task** | A provider-native task observed within a live query |
| **Mate** | An owner-private persistent collaborator with an identity; Clay is the lead Mate, and other Mates have their own roles |
| **Canonical Clay** | The lead Mate, Clay, acting through its supported reviewed product controls |
| **View** | A saved workspace pane arrangement |
| **Folder** | Persistent session-list organization |
| **Worktree** | A separate Git working directory for parallel work |
| **Overlay / Dock** | A tool over the workspace / space reserved beside sessions |
| **Follow / Pin** | A file pane tracking selection / staying on one file |

## Records

**Knowledge** holds maintained reference documents and typed databases. A **schema** defines database fields and types; a **view** selects columns, filters, and ordering without duplicating records.

**Project Logs** preserve requested work, outcomes, decisions, verification, and next action. **Issues** track actionable work through a lifecycle. **Notes** keep reminders visible while they need attention.

**Mate Memory** is Mate-specific recorded material. **Me** is owner-private knowledge curated by Clay. A reported observation is a proposal until canonical curation.

## Delivery and execution

**Draft** is unsent content. **Queued** means accepted for later delivery. **Claimed** means delivery has begun. **Acknowledged** means a receiving path accepted the request. **Completed** requires an actual finished outcome.

**Proposed** is awaiting a decision. **Persisted** means saved. **Rendered** means observed in a particular visible UI, which is different from merely accepted navigation.

**Stopped** means continuation was interrupted. It does not mean prior effects were reversed. **Unknown** means the effect cannot yet be proven.

## Automation

A **delayed message** is a one-off timed conversation input. A **Mate schedule** is reviewed recurrence for a private Mate. A **Scheduled Task** runs a project Driver/Worker pair. **Loop/Ralph** uses its own prepared task and verification workflow.

**Skip** omits an overlapping start. **Coalesce** combines eligible starts into one queued opportunity. **Pause** changes future scheduling; **Stop** targets execution.

## Access

**Public project** means accessible under authenticated workspace rules, not anonymously published. **Exact access** applies to one target; **inherited access** comes from its parent. **Permission mode** governs runtime tool handling and does not replace account authorization.

Follow the linked task guides from [Getting started](/docs/getting-started) and [Navigation](/docs/navigation).
