# Provider capabilities and interfaces

Clay Studio brings different coding agents into one workspace. The provider you choose determines available models, effort controls, native tasks, and some tool behavior. Use the session's offered controls as the guide to what your installed version supports.

## Choose an interface

| Interface | When to use it |
| --- | --- |
| **GUI session** | Work through Clay Studio's conversation, composer, permission cards, and tool views |
| **TUI session** | Use a supported coding agent's own interactive terminal interface inside the workspace |
| **Terminal** | Run shell commands yourself, including installation and provider login |

For example, choose a GUI session to discuss a change and review tool activity beside your files. A TUI is useful if you prefer the agent's native terminal controls. The current integration offers Claude Code GUI and TUI sessions; the other listed providers offer GUI sessions. A provider having a terminal application does not automatically make its TUI available inside Clay Studio.

## Provider setup scope

**Personal → AI providers** shows all registered coding agents and the exact runtime account used for discovery and sign-in. Providers without mapped OS-account support remain unavailable on an OS-isolated server. A shared server HOME means shared provider credentials, even when you open the page from Personal settings.

Claude Code and Codex offer reviewed, per-runtime installation on supported non-root macOS and Linux accounts. Other providers and unsupported contexts show setup instructions. Provider logout and credential inspection are unavailable there. Audio transcription keys have their own per-account connection list; they do not configure general model APIs. These settings operations are excluded from canonical Clay tools. See [Provider sign-in](/docs/provider-auth#manage-providers-in-personal-settings).

## Check the features you need

Create a session, open its model picker, and check the available effort and permission controls. Model access depends on your provider account. **Auto** permission mode may fall back to another mode; the session displays the effective setting.

[Background tasks](/docs/background-task-conversations) vary by provider. Supported Claude tasks can show conversations or output; another provider may display a task count without a readable transcript. A native task is different from a [Split Worker](/docs/drivers-workers), which has its own linked work session.

The [usage overview](/docs/usage-and-context) lists all vendors, but integrated account readings, session reports, and external dashboard links have different availability. Read the entry's status rather than treating missing data as zero usage.

## Continue across providers

Project files, instruction files, Logs, and a written handoff help another provider continue the work. Provider-specific background tasks and internal reasoning do not transfer as a complete running environment.

Use [Session settings and handoffs](/docs/session-settings) to create the continuation. Tell the new agent what changed, which checks finished, and what remains. If the previous task involved an external action, check its result before asking another provider to repeat it.

Connected tools also depend on the conversation's access and the provider integration. Ordinary coding may work while a particular Clay Studio tool is unavailable. [MCP connections](/docs/mcp-servers) explains connection scope; [Projects and Mates](/docs/clay-vs-mates) explains Clay's additional workspace controls.

## Provider integration limits

Qwen Code can show native clarification questions through Clay Studio's question card. Requests with more than three questions cannot be represented by that card and are cancelled. Single-file edit reviews use the provider's complete before-and-after content; incomplete or multi-file edit requests are refused rather than shown as an empty review. Stopping the turn dismisses its pending question or review.

Kiro effort selection is unavailable in Clay Studio’s model picker and canonical conversation controls. The internal adapter can apply an effort value only when the exact open or restored session advertises it under `effortLevel`; those session-specific choices are not yet exposed through Clay Studio’s effort catalog. A missing option does not imply support. Kiro turn-metering events remain provider data; they do not supply a verified token or billing total in Clay Studio.

GitHub Copilot CLI applies reasoning effort when its shared server starts. Clay Studio cannot change that launch setting for one conversation while sharing the server; conflicting requests fail. Its session effort control remains unavailable.

Antigravity CLI starts in its explicit supervised headless mode. Actions that need native approval can be refused by the CLI without opening a Clay Studio permission card, and the response may still finish successfully. Read the tool output before assuming a requested action happened. This integration does not forward Clay Studio custom tools to Antigravity.

OpenCode, Grok Build and Junie use the shared ACP approval and cancellation path. Their runtime-advertised capabilities determine session support; this does not provide every native CLI feature or a verified equivalent for every provider setting.
