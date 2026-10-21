# Loop and Ralph

The guided Loop interview prepares bounded autonomous work in the current project Driver session. Ralph uses prompt and judge contracts for repeated coding iterations. The legacy task scheduler and newer project Scheduled Tasks have separate configuration paths.

## Start a guided Loop

1. Open an eligible ordinary project GUI session.
2. Wait for its current work to finish.
3. Choose **Start Loop interview** beside the composer.
4. Answer the Driver's questions.
5. Review **Loop brief ready for review**.
6. Read the objective, completion checks, continuation limit, and time limit.
7. Choose **Edit**, **Cancel**, or **Start**.

Edit exposes **Objective** and **Completion checks**; put separate checks on separate lines and Save. The reviewed brief's version matters, so use the current card rather than an old proposal.

The card explicitly states: **Start enables Skip Permissions for this run. Your previous setting is restored when it ends.** Read that disclosure before starting. A Loop interview is not a promise that a routine Ask-mode run will keep prompting at each tool.

A useful objective is “Repair the export bug,” with checks naming the specific reproduction and existing validation command. “Improve everything” lacks a reliable exit condition.

## Prepare Ralph

Ask the assistant to set up a Ralph loop for a bounded coding task. Its project contracts use `.claude/PROMPT.md` and `.claude/JUDGE.md`.

Specify allowed files, excluded work, observable acceptance criteria, meaningful verification, limits, and what should happen on failure or missing input. Read the actual contracts before unattended execution.

A judge should inspect evidence rather than merely accept the executor's claim. Repeated iterations do not guarantee correctness or restore files on failure.

## Existing task scheduling

Older prepared task records can retain prompt/judge files, model settings, recurrence, and run history. A retained legacy Month/Week scheduler is not a separate Calendar tool in the current project palette. Do not look for a standalone Calendar or Todo workbench to start these workflows.

For current timed project execution, open **Scheduled** and use [Project Scheduled Tasks](/docs/scheduled-tasks), whose form requires an explicit Driver/Worker execution pair. Inspect an older task's instructions and runtime before deliberately migrating its work into a new schedule; the old and new records should not both run unintentionally.

## Inspect and recover

Read the actual session output, checks, and remaining work. Pause future recurrence and Stop current execution separately. After an interruption, inspect changed files and running processes before resuming.

See [Automation overlap](/docs/automation-overlap), [Permissions](/docs/permissions), and [Stop and recovery](/docs/stop-recovery).
