# Recurring Mate messages

A Mate schedule delivers a message to an owner-private Mate conversation at a reviewed time or recurrence. It is useful for a continuing check-in or research prompt. It does not create a project Driver/Worker execution pair.

## Ask for a schedule

In the intended Mate conversation, describe the message and cadence:

“Every Monday at 9:00, ask me which research question I want to investigate this week. Use the server's timezone and show me the proposed schedule.”

The Mate can interview you, prepare the message, and present a structured review. Scheduling can also be included in a new Mate's reviewed creation intent.

1. Check the target Mate and conversation.
2. Read the exact message.
3. Verify the date, time, and displayed server timezone.
4. Check recurrence and any end condition.
5. Approve the actual schedule card.

A conversational statement saying “approved” is not a substitute for the authenticated review. A cancelled proposal creates no approved schedule.

## Recurrence

Supported schedule rules include anchored day, week, month, and year repeats and eligible within-day intervals. A schedule can end after a number of deliveries or on a date. Ask for a simple cadence unless the task needs more.

Messages are bounded; a schedule prompt should identify a task rather than embed a long manual. Store larger reference material in the Mate's Knowledge.

Server timezone matters when you travel or connect from another device. Do not assume a browser's clock changes the saved cadence.

## Update or cancel

Ask the Mate to list or read its schedules, then request a change to the specific one. Review the updated message, timing, and target before approval. Cancellation also uses a reviewed lifecycle action.

After cancellation, inspect the saved status. A delivery already in progress may have effects that cancellation cannot recall.

## Delivery limits

Missed recurring times can coalesce into one admitted delivery followed by the next future occurrence. The system does not promise to replay every missed interval after downtime or exactly-once provider execution across a crash.

Check the pending message and conversation outcome rather than counting a scheduled occurrence as completed work. A stopped target or changed owner authorization is not permission to redirect it.

See [Delayed messages](/docs/delayed-messages), [Project Scheduled Tasks](/docs/scheduled-tasks), and [Automation overlap](/docs/automation-overlap).
