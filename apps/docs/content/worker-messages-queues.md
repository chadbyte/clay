# Worker messages and queues

Messages to a Worker should identify the exact delegated task. The Driver conversation and Worker conversation are separate delivery targets, even when they appear side by side.

## Send steering

1. Open the linked Worker conversation.
2. Confirm its assigned task, especially if a previous Worker was replaced.
3. Read its latest status.
4. Send a concise correction or follow-up.
5. Check whether the message is pending or delivered.

Example: “Keep the existing API. Add validation only at the parser boundary, and report the relevant check result.” Include a concrete correction rather than “do it differently.”

Sending to a busy Worker can queue work. It is not necessarily an interrupt of the tool currently running. If the current action must stop, use the appropriate Stop/interrupt action, then inspect before continuing.

## Manage pending messages

Use the queue controls exposed for the exact conversation. Edit or cancel pending messages you own, save edits, and check the resulting order. Once delivery starts, a message may no longer be editable or cancellable.

Do not repeat a message merely because no reply has appeared. First check the queue, transcript, permission cards, and provider state. A Worker can be waiting for input or a long command.

A stopped queue needs explicit resumption. Read pending items before **Resume queue** so an old instruction does not restart after the task changes.

## Understand message status

Queued means the message is waiting. Delivered or acknowledged means it reached the receiving system; the Worker may still be processing it. Open the conversation to read its response and task result.

Automatic message previews provide a brief view of recent assistant output. Hover or focus can recall the latest preview; open the full conversation for context and tool evidence.

## When replacing a Worker

Review or cancel instructions aimed at the previous Worker. Do not assume old pending messages should be replayed against the replacement. Describe current files, observed checks, and the next task in the handoff.

The Driver should still review results after follow-up work. Ask for changed files, actual verification outcomes, unresolved issues, and running processes.

See [Drafts and queue](/docs/drafts-and-queue), [Worker lifecycle](/docs/worker-lifecycle), and [Drivers and Workers](/docs/drivers-workers).
