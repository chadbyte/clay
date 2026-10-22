# Split Workers

Split Workers let a project Driver delegate bounded execution while retaining the main task context. They are linked work sessions with visible activity, not simply extra browser panes.

## Delegate a useful task

Ask the Driver to use a Split Worker and specify the allowed area, outcome, acceptance criteria, and checks. For example:

“Use a Split Worker to repair the parser's empty-input handling. Limit edits to the parser and existing tests, run the relevant checks, and report any uncertainty. Do not commit.”

Read the proposal, choose an available runtime/model/effort, and select **Run with Split Worker**. **Continue here** keeps the work in the current conversation.

Follow [Drivers and Workers](/docs/drivers-workers) for the complete creation and review workflow.

## Operate existing work

Use [Worker lifecycle](/docs/worker-lifecycle) for interruption, deliberate resumption, replacement, and confirmed removal. Use [Worker messages and queues](/docs/worker-messages-queues) for steering and pending delivery.

Multiple Workers can belong to a Driver. Keep their task and file boundaries clear. They can share a working directory, so a visual split does not prevent conflicting edits. [Worktrees](/docs/worktree-sharing) provide separate filesystem workspaces where needed.

## Review the result

Open the exact Worker's conversation and inspect its report and tool evidence. Confirm changed files, actual checks, unresolved failures, and running processes.

The Driver is responsible for independent review against the user's criteria. A Worker-reported pass is evidence to assess; it is not a claim that Driver verification happened.

Provider-native [background tasks](/docs/background-task-conversations) have a different lifecycle and can expose more limited conversation/output inspection. Do not assume a native task is a separately controllable Split Worker.
