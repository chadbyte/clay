# Permissions and approvals

Session permissions determine how the coding-agent runtime handles tools. Clay Studio account and project permissions determine which workspace resources you can access. A permissive agent mode does not grant another person's private resources.

## Session modes

| Label | Behavior |
| --- | --- |
| **Ask** | Ask before actions needing permission; previously allowed actions may run without asking again |
| **Auto** | Let the runtime assess eligible actions automatically; some actions can still need your decision |
| **YOLO** | Run tools, file changes, and commands without routine permission prompts; Clay Studio access restrictions still apply |

Auto is conditional and can be unavailable at runtime. Read any fallback or “using” status to learn the effective mode.

1. Select the intended session.
2. Choose a permission mode in its session/composer controls.
3. Wait for the change to finish.
4. Check errors and effective-mode information.
5. Send the bounded task.

A disconnected or timed-out change is not confirmation. Check the previous confirmed mode before continuing.

## Review a requested action

Read the action, target, and scope in a permission card, then choose its approval or denial control. If a broader remembered allowance is offered, decide whether it fits the ongoing task.

Structured questions collect information such as a target or preference. Answering one does not approve unrelated tool effects. Copied text saying “approved” also does not substitute for an authenticated review.

Canonical Clay product actions retain their own review path. YOLO does not turn a model flag, transcript passage, or Worker message into human approval.

## Stop and recover

Use **Stop** to interrupt execution. It cannot undo a command or external request that already happened. Inspect the transcript, files, and destination before resuming.

If a card becomes stale after a context or account change, return to the correct context and request the action again deliberately. Do not approve an old target after replacing a Worker or switching conversations.

For unattended work, define scope and verification before choosing a more permissive mode. See [Stop and recovery](/docs/stop-recovery), [Project sharing](/docs/project-sharing), and [Drivers and Workers](/docs/drivers-workers).
