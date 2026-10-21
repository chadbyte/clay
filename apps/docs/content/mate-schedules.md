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

You can request daily, weekly, monthly, or yearly recurrence and supported intervals within a day. For example: “Every weekday at 9:00 for the next four weeks.” The review card shows the interpreted timing and end condition.

Messages are bounded; a schedule prompt should identify a task rather than embed a long manual. Store larger reference material in the Mate's Knowledge.

Server timezone matters when you travel or connect from another device. Do not assume a browser's clock changes the saved cadence.

## Update or cancel

Ask the Mate to list or read its schedules, then request a change to the specific one. Review the updated message, timing, and target before approval. Cancellation also uses a reviewed lifecycle action.

After cancellation, inspect the saved status. A delivery already in progress may have effects that cancellation cannot recall.

## Delivery limits

If the server misses several scheduled times, those messages can be combined into one delivery. Later messages follow the schedule again. After a crash, check the conversation before requesting another delivery: the provider may already have received the previous message.

Check the conversation to see the result of a delivery. If access changed or the conversation is unavailable, resolve that before requesting a replacement schedule.

See [Delayed messages](/docs/delayed-messages), [Project Scheduled Tasks](/docs/scheduled-tasks), and [Automation overlap](/docs/automation-overlap).
