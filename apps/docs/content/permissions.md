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

[![Permission card with npm test details and Sure, Allow for session, and No actions.](/images/manual/permission-review.webp)](/images/manual/permission-review.webp)

*Read the command in Details before choosing. Allow for session is a broader choice than approving this one request.*

## Stop and recover

Use **Stop** to interrupt execution. It cannot undo a command or external request that already happened. Inspect the transcript, files, and destination before resuming.

If a card becomes stale after a context or account change, return to the correct context and request the action again deliberately. Do not approve an old target after replacing a Worker or switching conversations.

For unattended work, define scope and verification before choosing a more permissive mode. See [Stop and recovery](/docs/stop-recovery), [Project sharing](/docs/project-sharing), and [Drivers and Workers](/docs/drivers-workers).
