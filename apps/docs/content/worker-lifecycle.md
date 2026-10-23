# Worker lifecycle

A Worker belongs to a Driver and an assigned task. Use its conversation to inspect progress, stop work, or review the result. When several Workers are visible, identify them by their task rather than their position on screen.

## Create and inspect

You can turn Driver proposals of new Split Workers off, or limit them to your requests, in [Agent behavior](/docs/agent-behavior). Managing existing Workers and Stop are not affected. A reviewed Driver proposal offers **Run with Split Worker** and runtime choices. After accepting, wait for the Worker to appear and check that its assigned scope matches the proposal.

Open its conversation from the linked Worker control. Read both assistant messages and relevant tool output. A Worker can be active while the Driver is waiting, and a quiet transcript can be waiting on a tool, permission, or provider limit.

For multiple Workers, distinguish them by task and provider rather than pane position alone. Rearranging panes does not change their actual ownership.

## Read recent activity

The small loop icon in a Worker chip takes a short clockwise step when Clay Studio receives that Worker's reply, thinking output or tool activity. Rapid bursts share a step. It does not spin continuously or estimate progress. A quiet tool can still be running after the icon stops moving; the Worker's running state is separate.

Hover over a Worker chip, or focus it with the keyboard, to see its latest-conversation preview. A compact line above the message describes the latest observed activity and how long ago the server received it. The preview keeps the recent dialogue, provider and message time, and can show activity even when no recent message exists. Missing activity times are shown as unavailable. Opening the Worker conversation hides the preview. Reconnecting or reopening cached history does not count as fresh activity. Reduced-motion settings remove the rotation transition.

## Interrupt and resume

Open the Worker conversation from its tab, then choose **Stop Worker** in the conversation header. **Close Worker conversation** only dismisses the viewer. If the Worker remains stuck and its runtime supports force termination, choose **Force stop Worker** to terminate that runtime, retire its connection and pause queued work. The control stays visible but is disabled with **Force termination is not yet supported for this vendor** when unsupported. A runtime that is starting or lacks the required operation also has a disabled control with an explanation. **Stop Worker** remains available when the transcript appears idle. Then inspect the latest transcript and files. Stop prevents intended continuation but cannot roll back commands or network requests that already took effect.

To stop the Driver and all of its Workers together, use **Force stop session** in the Driver pane header and confirm **Force stop all work**. Every owned Worker, including older generations, must support force termination before this action can begin. An unsupported target blocks the whole action. A confirmed runtime exit still leaves detached commands and external requests unconfirmed; see [Stop and recovery](/docs/stop-recovery). Closing a pane or the Worker viewer does not stop its work.

Before resuming:

1. Identify the stopped Worker and its Driver.
2. Read pending messages.
3. Determine whether its last tool action completed.
4. Supply any changed scope.
5. Send the Driver a new message asking it to resume that Worker's interrupted task, with the updated scope.

Avoid resending the original task blindly; that can duplicate completed effects.

## Recover from missing provider sign-in

If a current Worker needs authentication, its owner can complete the provider's sign-in flow while viewing the Driver. You do not need to open the Worker conversation first. The sign-in window targets the Worker's provider, including when the Driver uses a different one.

Complete sign-in, inspect the Worker's failure and any partial work, then send the Driver a new message asking it to retry the exact task. Canceling or failing sign-in leaves the Worker and its conversation available. Replacing the Worker is unnecessary solely because it needs authentication. Stopped or uncertain tasks are not replayed by sign-in.

If the window reports that its context changed, return to the current Driver and explicitly retry the Worker to request sign-in again. A changed Worker, expired request, disconnected owner, or revoked permission can make the old request unavailable. For manual setup and provider limits, see [Provider sign-in](/docs/provider-auth).

## Replace

A replacement proposal offers **Replace Split Worker** or **Keep current Worker**. Read the proposed runtime and handoff before choosing. Replacement starts another Worker. Review any pending instructions for the old Worker and include current progress in the handoff.

Ask the new Worker to inspect the current working tree and prior observed results. Files can outlive the process that changed them.

## Remove

Worker removal is explicit. In the linked Worker controls, **Remove Worker session** first arms the action, then **Confirm Worker removal** confirms that target. An active Worker can require an additional confirmation.

A timeout can report an unknown removal outcome. Check whether the session remains before retrying. Removing a Worker and merely closing a tool or pane are different actions.

For ordinary ongoing steering, use [Worker messages and queues](/docs/worker-messages-queues). For reviewing delegated results, see [Drivers and Workers](/docs/drivers-workers). For unfinished commands and uncertain effects, see [Stop and recovery](/docs/stop-recovery).
