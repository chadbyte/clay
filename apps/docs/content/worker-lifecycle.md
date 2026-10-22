# Worker lifecycle

A Worker belongs to a Driver and an assigned task. Use its conversation to inspect progress, stop work, or review the result. When several Workers are visible, identify them by their task rather than their position on screen.

## Create and inspect

You can turn Driver proposals of new Split Workers off, or limit them to your requests, in [Agent behavior](/docs/agent-behavior). Managing existing Workers and Stop are not affected. A reviewed Driver proposal offers **Run with Split Worker** and runtime choices. After accepting, wait for the Worker to appear and check that its assigned scope matches the proposal.

Open its conversation from the linked Worker control. Read both assistant messages and relevant tool output. A Worker can be active while the Driver is waiting, and a quiet transcript can be waiting on a tool, permission, or provider limit.

For multiple Workers, distinguish them by task and provider rather than pane position alone. Rearranging panes does not change their actual ownership.

## Interrupt and resume

Use the relevant Stop/interrupt control for the active task. Then inspect the latest transcript and files. Stop prevents intended continuation but cannot roll back commands or network requests that already took effect.

Before resuming:

1. Identify the stopped Worker and its Driver.
2. Read pending messages.
3. Determine whether its last tool action completed.
4. Supply any changed scope.
5. Send the Driver a new message asking it to resume that Worker's interrupted task, with the updated scope.

Avoid resending the original task blindly; that can duplicate completed effects.

## Replace

A replacement proposal offers **Replace Split Worker** or **Keep current Worker**. Read the proposed runtime and handoff before choosing. Replacement starts another Worker. Review any pending instructions for the old Worker and include current progress in the handoff.

Ask the new Worker to inspect the current working tree and prior observed results. Files can outlive the process that changed them.

## Remove

Worker removal is explicit. In the linked Worker controls, **Remove Worker session** first arms the action, then **Confirm Worker removal** confirms that target. An active Worker can require an additional confirmation.

A timeout can report an unknown removal outcome. Check whether the session remains before retrying. Removing a Worker and merely closing a tool or pane are different actions.

For ordinary ongoing steering, use [Worker messages and queues](/docs/worker-messages-queues). For reviewing delegated results, see [Drivers and Workers](/docs/drivers-workers). For unfinished commands and uncertain effects, see [Stop and recovery](/docs/stop-recovery).
