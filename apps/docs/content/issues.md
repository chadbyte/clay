# Project Issues

Issues track concrete actionable project work through discovery, implementation, verification, and resolution. They are Clay Studio project records; linking one to GitHub is a separate operation.

## Create a useful Issue

1. Open **Issues** from the project tool palette.
2. Use the new-issue action.
3. Enter **Title**, **Summary**, **Type**, **Priority**, and **Details (Markdown)**.
4. Describe the observed problem, impact, reproduction, and acceptance criteria.
5. Select **Save issue**.

Types include bug, feature, and plan. Search existing Issues before creating another report of the same work.

Example: “Export fails when the name is empty,” with the input, observed error, expected validation behavior, and a check that reproduces it.

When an agent discovers a possible defect in a worktree, distinguish established project behavior from an error introduced during the current task. Baseline evidence matters; an intermediate failure does not automatically justify a new backlog item.

## Work and discussion

Open an Issue to inspect its status, details, revision history, linked work sessions, and **Discussion**. Add a comment to supply evidence or ask a question.

Use **Start work** where offered to create the associated Driver work session. Check the actual session link rather than starting an unrelated duplicate conversation. Record progress and verification in the Issue as the task develops.

## Resolve or close

The edit form offers Open, In progress, Resolved, and Closed. Code resolution includes **Resolution summary** and **Resolving commit SHA**. Clay Studio verifies commit evidence; a prose claim that a fix is committed is insufficient.

Use the supported close reason for declined, duplicate, or non-code decisions. Closing a proposal is different from proving a code fix. Do not create a fixture commit merely to satisfy resolution.

If verification is incomplete, retain that state and next action rather than marking the Issue resolved prematurely.

## GitHub and Notes

**Connect to GitHub** searches for matching work. Read any proposed match before selecting an ambiguous result or approving creation. If creation has an unknown result, inspect GitHub before retrying.

A short linked [Note](/docs/notes) can keep an open Issue visible on the attention board. The Issue holds evidence and progress; close the reminder when its action is done.

See [GitHub](/docs/github), [Project Logs](/docs/project-logs), and [Drivers and Workers](/docs/drivers-workers).
