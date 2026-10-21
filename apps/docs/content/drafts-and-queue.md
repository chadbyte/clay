# Drafts and the message queue

A draft is unsent composer content. A queued message is accepted work waiting for delivery. An active message has already begun delivery or processing. Treat these as separate states when deciding whether to edit or retry.

## Keep a draft

Write in the composer and switch back to the exact conversation when continuing it. Clay Studio maintains session-specific rich draft state, including supported attachment and context information. Do not treat an unsent draft as a completed transcript entry.

Before changing from a floating Mate conversation to its native workspace, finish any active upload or voice recording. The handoff needs the exact conversation's draft; a different session is not a fallback target.

## Inspect pending work

Sending while an agent is busy can add a pending message rather than starting another simultaneous turn. Review the queue near the composer.

1. Find the relevant pending item.
2. Check its text, images, timing, and author.
3. Use **Edit** to change a message you own.
4. Select **Save**, or **Cancel** to discard the edit.
5. Check the updated queue after saving.

The queued image editor supports previewing, replacing, removing, and adding images. Wait for image reads to finish before saving.

## Reorder or remove

Use a pending item's drag handle to reorder it. The handle also supports arrow-key reordering. Ordering changes which pending request is offered first; it cannot rewrite a turn already executing.

Use **Cancel queued message** to remove unwanted work. Controls depend on ownership and current item state. If delivery has claimed an item, inspect the transcript and status before assuming cancellation prevented execution.

Queue updates are revision-sensitive. If another person or process changed the queue, refresh its current state and reapply only the intended edit.

## Resume after Stop

A paused queue shows **Resume queue**. Read all pending items before choosing it, particularly after an interruption or reload. Stop is deliberate; queued work should not be assumed to resume automatically.

A future scheduled item can offer **Send now**. This releases it early; it does not guarantee an immediate completed response.

If a send is uncertain, inspect both queue and transcript before sending duplicate text. See [Delayed messages](/docs/delayed-messages), [Worker queues](/docs/worker-messages-queues), and [Stop and recovery](/docs/stop-recovery).
