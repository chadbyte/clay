# Stop and recovery

Use **Stop** when the active task must pause. Stop interrupts intended execution; it does not undo files, shell processes, messages, or external requests that have already taken effect.

## Stop deliberately

1. Confirm the session or Worker you intend to stop.
2. Choose its Stop/interrupt control.
3. Wait for the status update.
4. Read the final activity and any pending queue.
5. Inspect the affected files or external destination.

Closing Browser, Files, or a split pane changes presentation and is not the same as stopping an agent. Provider-native background tasks can have their own Stop control; check its exact target.

## Recover a stuck session

If a session stops making progress and new messages only join its queue, check **Force stop session** in that session pane's header. The control stays visible even when the composer has no Stop button. If the vendor cannot confirm force termination, it is disabled with **Force termination is not yet supported for this vendor**. Use ordinary **Stop** for interruption when its control is available.

Force stop is available only when the session and every Worker it owns have a supported runtime. An unsupported Worker disables the Driver's all-work action too; no session is partially stopped by that refused action. Starting runtimes and runtimes without a force-termination operation are also unavailable, with an explanation on the control.

When available, a confirmation dialog asks whether to stop the session and all of its Workers. Choose **Cancel** to leave work running, or **Force stop all work** to proceed. Clay Studio pauses their queues, retires their connections and asks each runtime to terminate. It reports whether each runtime's exit was confirmed. A failure or timeout remains unconfirmed; inspect the outcome before continuing.

Currently Antigravity supports force termination of its dedicated session process. Claude Code, Codex, Muse Code, Kiro CLI and the generic ACP integrations do not yet support this operation. A confirmed runtime exit does not establish that detached commands, child processes or external requests have stopped.

The pane stays open and conversation history is preserved. **Close pane** is a separate presentation action and does not stop execution. A delivery interrupted before acknowledgement is retained as failed rather than automatically replayed.

Inspect the transcript and affected files before continuing. Review pending messages, then choose **Resume queue** when they are still appropriate. Send a new message if there is no pending queue to resume.

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

For scheduled work, inspect the occurrence/run record. Queued jobs and interrupted jobs have different recovery paths. Check an uncertain external action before retrying; it may have completed even though the local connection failed.

## Resolve uncertainty

For a file edit, inspect the file and diff. For Git publication, check the actual remote commit or PR. For email, inspect the send result and destination mailbox where available. For a browser action, inspect the page, not just the accepted input.

If you cannot prove whether an action happened, keep the outcome explicit and avoid an automatic duplicate. Supply the concrete uncertainty when asking the agent to continue.

See [Drafts and queue](/docs/drafts-and-queue), [Worker lifecycle](/docs/worker-lifecycle), [Automation overlap](/docs/automation-overlap), and [Troubleshooting](/docs/troubleshooting).
