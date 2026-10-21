# Drafts and the message queue

A draft is unsent composer content. A queued message is accepted work waiting for delivery. An active message has already begun delivery or processing. Treat these as separate states when deciding whether to edit or retry.

## Keep a draft

When switching between project sessions in the current page, each composer can retain its text and attachments. Return to the same conversation to continue the draft. This is not a promise of recovery after reload or synchronization to another device; copy important unsent text before leaving the page.

For a Mate conversation, finish an upload or voice recording before switching between its floating panel and full workspace.

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

Use **Cancel queued message** to remove unwanted work. Controls depend on ownership and current item state. If delivery already started, check the transcript to see whether the request ran.

If the queue changed while you were editing, reopen its latest state and apply your change there.

## Resume after Stop

A paused queue shows **Resume queue**. Read all pending items before choosing it, particularly after an interruption or reload. Stop is deliberate; queued work should not be assumed to resume automatically.

A future scheduled item can offer **Send now**. This releases it early; it does not guarantee an immediate completed response.

If a send is uncertain, inspect both queue and transcript before sending duplicate text. See [Delayed messages](/docs/delayed-messages), [Worker queues](/docs/worker-messages-queues), and [Stop and recovery](/docs/stop-recovery).
