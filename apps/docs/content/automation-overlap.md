# Pause, skip, and overlap

Use Pause to prevent future scheduled starts and Stop to interrupt work already running. Overlap settings decide what happens when another scheduled time arrives before the previous run finishes.

## Choose overlap behavior

For a project Scheduled Task, open **Scheduled**, expand the task, and select **Edit**. Inspect:

**Skip a scheduled start while this task already has an active run**

When enabled, a scheduled start during an active run is skipped. When disabled, overlapping starts are combined into one queued follow-up, rather than a separate run for every missed time.

For example, a task scheduled every ten minutes can take twenty-five minutes to finish. Skip avoids another start during that run. Coalescing preserves one follow-up opportunity rather than starting several concurrent copies.

## Pause versus Stop

**Pause** disables future scheduled starts. It does not by itself prove an active Driver, Worker, command, or external request stopped.

To halt current execution:

1. Open the actual run.
2. Confirm the Driver/Worker target.
3. Use the relevant Stop control.
4. Inspect its last observed result and pending work.
5. Resume only when the remaining action is understood.

**Run now** is a start request, not an override of every readiness, busy, or Stop rule.

## Inspect outcomes

Read task status and open its run. Needs input, Waiting for Worker, Driver reviewing, completed, skipped, and failed describe different situations.

Open the run to see whether it is waiting, executing, or under Driver review. If the connection was lost, check the last result before retrying.

## Restart and missed times

The server must be running for automation. After a restart, check restored pending work separately from a task that was already executing.

Missed Mate messages can be combined into one delivery, followed by the next future occurrence. Delayed composer messages are one-shot jobs. Legacy Loop/Ralph follows its own task configuration and history. Do not apply one system's recovery assumptions to another.

Before retrying a task that sends mail, publishes work, or changes an external service, check that destination. The action may have completed before the connection failed.

See [Scheduled Tasks](/docs/scheduled-tasks), [Mate schedules](/docs/mate-schedules), [Delayed messages](/docs/delayed-messages), and [Stop and recovery](/docs/stop-recovery).
