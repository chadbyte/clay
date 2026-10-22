# Delayed composer messages

Use the composer's schedule control for a one-off message to the current conversation after a delay. This is different from recurring Mate messages and project Scheduled Tasks.

## Schedule a message

1. Select the exact conversation.
2. Write the follow-up and add any supported attachments.
3. Choose **Schedule message** beside the composer.
4. Enter a delay from **1 to 1440 minutes**.
5. Press Enter to confirm the delay.
6. Check the displayed delay label.
7. Send the message.

For example, enter 30 to queue “Check whether the local build completed and report its result” for thirty minutes later.

Selecting a delay prepares timing for the outgoing message; it does not submit the draft by itself. Clicking an active delay control clears it. Escape cancels the inline delay entry.

The delay is relative to submission, not a recurring wall-clock schedule. Use [Mate schedules](/docs/mate-schedules) or [Scheduled Tasks](/docs/scheduled-tasks) for recurrence.

## Inspect pending delivery

The queued item shows its scheduled state. Review its target, text, and timing. A future pending item can offer **Send now** to release it early.

Use **Edit** and **Save** to change supported pending content, or **Cancel queued message** to remove it. Ownership and current state determine which controls are available. Once delivery begins, editing or cancelling may no longer prevent execution.

A busy session waits until it can process the due message. A due time is not a guarantee of a completed provider response at that time.

## Keep the server available

Scheduling runs on the Clay Studio server. Closing your browser does not itself cancel a saved message, but the server must be running and the target must remain valid and accessible.

After a restart, check the pending queue and conversation before resending. The provider may already have received a message even if its response did not reach your browser.

## Common problems

If delivery is paused, read the queue and use its resume control when ready. If the target session was deleted or access changed, choose an accessible conversation and review the task before scheduling it again.

See [Drafts and queue](/docs/drafts-and-queue), [Automation overlap](/docs/automation-overlap), and [Stop and recovery](/docs/stop-recovery).
