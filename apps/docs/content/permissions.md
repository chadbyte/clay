# Permissions and approvals

Session permissions determine how the coding-agent runtime handles tools. Clay Studio account and project permissions determine which workspace resources you can access. A permissive agent mode does not grant another person's private resources.

## Session modes

| Label | Behavior |
| --- | --- |
| **Ask** | Ask before actions needing permission; previously allowed actions may run without asking again |
| **Auto** | Let the runtime assess eligible actions automatically; some actions can still need your decision |
| **YOLO** | Run tools, file changes, and commands without routine permission prompts; Clay Studio access restrictions still apply |

Start with **Ask** while learning a project. Choose a more permissive mode when the task's scope and checks are clear. Auto can be unavailable for a provider; read the displayed fallback or “using” status to see the mode in effect.

If the server was started with `--dangerously-skip-permissions`, the picker can be disabled with **YOLO permissions forced by the server setting**. Ask the server operator to change that policy if you need routine prompts.

You may also see **Plan**, **Auto-accept edits**, or **Don't ask** as workflow statuses. These describe the active workflow rather than additional choices in the Ask/Auto/YOLO picker.

1. Select the intended session.
2. Choose a permission mode in its session/composer controls.
3. Wait for the change to finish.
4. Check errors and effective-mode information.
5. Send the bounded task.

A disconnected or timed-out change is not confirmation. Check the previous confirmed mode before continuing.

## Review a requested action

Read the action, target, and scope in a permission card, then choose its approval or denial control. If a broader remembered allowance is offered, decide whether it fits the ongoing task.

Structured questions collect information such as a target or preference. Answering one does not approve unrelated tool effects. Use an action's review card to approve it.

Some Clay Studio actions still ask you to review a particular change regardless of session permission mode. Use the review card for that action.

Codex can also request additional filesystem or network permissions for a turn. Clay Studio currently declines these scoped grants because its review card cannot represent their exact scope. Requests without enough details to review are also declined. Approving an ordinary command or tool does not grant those additional permissions. Ask for an alternative within the session's existing access when a task needs such a grant.

Codex's native file-change approval requests are currently declined because they identify an item or directory without including the exact edits. Clay Studio does not present an empty approval card or use that directory as permission for unspecified changes. Ask the agent to prepare a patch you can review separately.

For Kiro CLI and the ACP providers (OpenCode, Kimi, Grok, Copilot, Qwen, and Junie), Clay Studio sends a one-time approval to the provider. An ordinary approval does not create a remembered allowance in that provider. If the provider offers only a persistent grant, Clay Studio cancels the request because the review cannot represent its scope. Malformed or unsupported approval choices are also refused.

[![Permission card with npm test details and Sure, Allow for session, and No actions.](/images/manual/permission-review.webp)](/images/manual/permission-review.webp)

*Read the command in Details before choosing. Allow for session is a broader choice than approving this one request.*

## Stop and recover

Use **Stop** to interrupt execution. It cannot undo a command or external request that already happened. Inspect the transcript, files, and destination before resuming.

In Codex, Stop retires pending command and MCP approvals. A delayed answer to an old review cannot approve the stopped request. Send a deliberate continuation and review any new request before continuing.

If Codex reports that approval tracking reached its safety limit, the query is being stopped. Wait for the outcome, inspect unfinished work, then send a new message deliberately. Older requests are refused rather than replayed to make room.

In Kiro CLI and the ACP providers, Stop, a completed or failed turn, and retirement of the runtime connection cancel pending reviews. A delayed answer cannot approve work in a later turn or replacement query. Closing a pane remains a separate presentation action.

If a card becomes stale after a context or account change, return to the correct context and request the action again deliberately. Do not approve an old target after replacing a Worker or switching conversations.

For unattended work, define scope and verification before choosing a more permissive mode. See [Stop and recovery](/docs/stop-recovery), [Project sharing](/docs/project-sharing), and [Drivers and Workers](/docs/drivers-workers).

## Personal execution preferences

Open **Settings → Personal → AI providers → Execution & permissions** for auto-continuation and personal Claude CLI allow rules. Auto-continuation can send a continuation when a rate-limited conversation becomes eligible to retry, resuming work and consuming usage without another message from you.

Under **Command permissions**, choose **Edit** for **Personal allow rules**. Managed defaults apply separately. Save your rules and check the local result: they apply on the next Claude invocation. A failed save keeps your draft for retry; a message that the rules were saved to your account but not installed requires checking filesystem access and saving again. Cancel asks before discarding edited rules.

These rules are separate from the conversation's permission mode. On an OS-user server they install in your OS home; otherwise they install in the shared server process home and can affect other Claude CLI launches there. Server restrictions still apply.
