# Pause, skip, and overlap

Automation has several layers: a saved schedule, an occurrence due to start, a queued delivery, and an executing task. Controls at one layer do not necessarily change every other layer.

## Choose overlap behavior

For a project Scheduled Task, open **Scheduled**, expand the task, and select **Edit**. Inspect:

**Skip a scheduled start while this task already has an active run**

When enabled, an overlapping scheduled start is recorded as skipped-busy. When disabled, eligible overlapping starts are combined into one queued run. This is coalescing, not a backlog containing every missed tick.

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

A queued occurrence is not started work. A started Worker is not a completed reviewed result. An unknown outcome after a connection loss must remain uncertain until reconciled.

## Restart and missed times

The server must be available for automation. Queued work can be restored, while interrupted claimed/running work can require explicit investigation.

Mate recurrence can coalesce missed times into one delivery and then continue with a future occurrence. Delayed composer messages are one-shot jobs. Legacy Loop/Ralph follows its own task configuration and history. Do not apply one system's recovery assumptions to another.

Before a retry, inspect the target files or external destination. No scheduler can guarantee that a remote side effect never happened merely because the local process crashed.

See [Scheduled Tasks](/docs/scheduled-tasks), [Mate schedules](/docs/mate-schedules), [Delayed messages](/docs/delayed-messages), and [Stop and recovery](/docs/stop-recovery).
