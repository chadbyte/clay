# Stop and recovery

Use **Stop** when the active task must pause. Stop interrupts intended execution; it does not undo files, shell processes, messages, or external requests that have already taken effect.

## Stop deliberately

1. Confirm the session or Worker you intend to stop.
2. Choose its Stop/interrupt control.
3. Wait for the status update.
4. Read the final activity and any pending queue.
5. Inspect the affected files or external destination.

Closing Browser, Files, or a split pane changes presentation and is not the same as stopping an agent. Provider-native background tasks can have their own Stop control; check its exact target.

## Resume an interrupted task

Before resuming, establish what happened:

- Did the last command finish, fail, or remain running?
- Were files saved?
- Is an external action's outcome known?
- Are pending messages still appropriate?
- Has the provider or target changed?

Then send a bounded continuation, such as: “Inspect the working tree and the last command result. Continue only the unfinished checks. Do not repeat publication.”

A paused queue displays **Resume queue**. Read its items before resuming. Reloading should not be treated as an instruction to replay stopped work.

## Recover after disconnection or restart

Reconnect to the same server, account, project, and session. Wait for history and queue state to reload. An unseen acknowledgement can leave a completed action that your browser did not display.

For scheduled work, inspect the occurrence/run record. Queued jobs and interrupted jobs have different recovery paths. An uncertain external effect should be reconciled before retry, because process recovery cannot guarantee exactly-once execution at a remote service.

## Resolve uncertainty

For a file edit, inspect the file and diff. For Git publication, check the actual remote commit or PR. For email, inspect the send result and destination mailbox where available. For a browser action, inspect the page, not just the accepted input.

If you cannot prove whether an action happened, keep the outcome explicit and avoid an automatic duplicate. Supply the concrete uncertainty when asking the agent to continue.

See [Drafts and queue](/docs/drafts-and-queue), [Worker lifecycle](/docs/worker-lifecycle), [Automation overlap](/docs/automation-overlap), and [Troubleshooting](/docs/troubleshooting).
