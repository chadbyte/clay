# Provider capabilities and interfaces

Clay Studio brings different coding agents into one workspace. The provider you choose determines available models, effort controls, native tasks, and some tool behavior. Use the session's offered controls as the guide to what your installed version supports.

## Choose an interface

| Interface | When to use it |
| --- | --- |
| **GUI session** | Work through Clay Studio's conversation, composer, permission cards, and tool views |
| **TUI session** | Use a supported coding agent's own interactive terminal interface inside the workspace |
| **Terminal** | Run shell commands yourself, including installation and provider login |

For example, choose a GUI session to discuss a change and review tool activity beside your files. A TUI is useful if you prefer the agent's native terminal controls. The current integration offers Claude Code GUI and TUI sessions; the other listed providers offer GUI sessions. A provider having a terminal application does not automatically make its TUI available inside Clay Studio.

## Check the features you need

Create a session, open its model picker, and check the available effort and permission controls. Model access depends on your provider account. **Auto** permission mode may fall back to another mode; the session displays the effective setting.

[Background tasks](/docs/background-task-conversations) vary by provider. Supported Claude tasks can show conversations or output; another provider may display a task count without a readable transcript. A native task is different from a [Split Worker](/docs/drivers-workers), which has its own linked work session.

The [usage overview](/docs/usage-and-context) lists all vendors, but integrated account readings, session reports, and external dashboard links have different availability. Read the entry's status rather than treating missing data as zero usage.

## Continue across providers

Project files, instruction files, Logs, and a written handoff help another provider continue the work. Provider-specific background tasks and internal reasoning do not transfer as a complete running environment.

Use [Session settings and handoffs](/docs/session-settings) to create the continuation. Tell the new agent what changed, which checks finished, and what remains. If the previous task involved an external action, check its result before asking another provider to repeat it.

Connected tools also depend on the conversation's access and the provider integration. Ordinary coding may work while a particular Clay Studio tool is unavailable. [MCP connections](/docs/mcp-servers) explains connection scope; [Projects and Mates](/docs/clay-vs-mates) explains Clay's additional workspace controls.
