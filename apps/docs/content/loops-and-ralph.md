# Loop and Ralph

Use a loop when a task needs repeated attempts and has a clear finish line. For example, an agent might reproduce an export bug, repair it, run a check, and continue if the check still fails. Decide what counts as finished and how long it may continue before starting.

| Workflow | How you prepare it |
| --- | --- |
| **Guided Loop** | Answer an interview in the current project session and review its objective, checks, and limits |
| **Ralph** | Prepare prompt and judge files that describe repeated coding work and how to evaluate it |
| **Scheduled Task** | Choose when a project Driver/Worker pair should run; use this for timed or recurring work |

## Start a guided Loop

1. Open an ordinary project GUI session and wait for current work to finish.
2. Choose **Start Loop interview** beside the composer.
3. Answer the Driver's questions about the outcome and completion checks.
4. Review **Loop brief ready for review**, including continuation and time limits.
5. Choose **Edit**, **Cancel**, or **Start**.

Edit lets you change **Objective** and **Completion checks**; enter separate checks on separate lines and Save. For an export bug, name the failing input and the existing test command. This gives the agent a way to decide when the repair is complete.

**Start enables Skip Permissions for this run. Your previous setting is restored when it ends.** Review the allowed work and limits before starting; this run will not keep asking for routine tool approvals.

## Prepare Ralph

Ask the assistant to set up a Ralph loop for a bounded coding task. It prepares `.claude/PROMPT.md` for the work and `.claude/JUDGE.md` for evaluating the result. Read both before unattended execution.

Describe allowed files, excluded work, acceptance criteria, checks, limits, and what to do when input is missing. The judge should examine the resulting files and check output. Repeating an attempt alone does not establish that it succeeded.

## Schedule or migrate work

For current timed execution, use [Project Scheduled Tasks](/docs/scheduled-tasks). Its form requires a Driver and Split Worker.

Older scheduled Ralph tasks can retain their own prompt/judge files, models, recurrence, and history. If migrating one, inspect those settings and pause the old schedule before starting an equivalent new one, so both do not run unintentionally.

## Inspect an interrupted run

Read the current files, completed checks, and any running commands before continuing. Pausing a schedule affects future starts; stopping the active session affects current execution. [Stop and recovery](/docs/stop-recovery) gives the recovery sequence.
