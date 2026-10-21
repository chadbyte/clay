# Background task conversations

Some coding agents start smaller tasks inside a conversation—for example, an agent investigating one part of a codebase or a command running in the background. Clay Studio can display these provider-native tasks when the provider exposes them. They differ from [Split Workers](/docs/drivers-workers), which are separate linked work sessions managed by a Driver.

## Inspect a task

When background-task tabs appear in the session:

1. Open the task you want to inspect.
2. Read its status and available conversation or output.
3. Use **Refresh** if the display needs updating.
4. Return to the parent conversation to steer the overall request.

For supported Claude background agents, the viewer shows recorded conversation pages and tool activity. A shell or monitoring task shows a limited portion of its output instead. Other providers may show that inspection is unavailable.

Recent assistant messages can appear as brief previews beside task tabs. Hover or keyboard focus recalls the latest preview; open the viewer for the surrounding work.

## Understand the task list's lifetime

Completed tasks can remain listed while the same provider execution context is available, including after refreshing the page. Reinitializing the provider clears the list. It is a temporary view, not a permanent archive of every task.

If a tab disappears, use the parent conversation and changed files to inspect the result. Its disappearance does not undo work. After repeated refresh failures, automatic refreshing stops; use Refresh after resolving the connection problem.

## Stop or continue

Use the task's **Stop** control when it is offered. Check whether you want to stop one task or the parent session. Stopping does not undo saved files or commands that already ran.

Give follow-up instructions in the parent conversation unless the task UI offers input. Not every native task accepts messages or can resume after an interruption.

Clay can observe task counts, but cannot currently open, read, or stop an individual native task through its workspace-control tools. Use the task viewer for those actions. For recovery after a connection loss, see [Stop and recovery](/docs/stop-recovery).
