# Background task conversations

Some runtimes create native background tasks during a session. These are different from Clay Studio Split Workers: the runtime owns their execution, and Clay Studio displays only the task information it can bind to the current session.

## Inspect a task

When task tabs or background-task controls appear:

1. Open the task associated with the intended session.
2. Check its identity and status.
3. Read the transcript or output available for that task.
4. Use **Refresh** if the displayed state needs updating.
5. Return to the parent conversation to steer the overall request.

For Claude native agent tasks, Clay Studio can display recorded conversation pages and tool evidence when the runtime provides a valid transcript binding. Shell or monitor tasks expose bounded output rather than an invented full conversation.

Other providers can show an explicit unavailable state. A visible task count does not guarantee that a transcript reader or writable task conversation exists.

## Status and previews

Recent assistant messages may appear as temporary previews beside task tabs. Hover or keyboard focus can recall the latest preview. Open the full viewer to inspect the surrounding work.

Completed tasks can remain listed while the same live query is available, including across a client refresh. A new provider query initialization resets the task catalog. This is not a separate durable archive of every background task.

Do not use a disappeared task tab as proof that its effects were undone. Check the parent transcript and changed files.

## Stop the right task

Use a task's Stop control only when it is offered for that exact task. Check whether you intend to stop one task or the parent session. A successful stop request is not rollback of work already performed.

If polling fails repeatedly, automatic refresh stops; use explicit Refresh after resolving the connection or runtime problem. Switching sessions or closing the viewer invalidates its outstanding reads.

## Continue safely

Use the parent conversation to describe the desired follow-up unless the UI explicitly offers supported task input. Do not assume every provider task accepts direct messages or can resume after a crash.

Canonical Clay can observe existing task counts, but task-specific viewer navigation, output inspection, and Stop are not general canonical controls. Use the human task viewer for these operations.

See [Provider capabilities](/docs/provider-capabilities), [Drivers and Workers](/docs/drivers-workers), and [Stop and recovery](/docs/stop-recovery).
