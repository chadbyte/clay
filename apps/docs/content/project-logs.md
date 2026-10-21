# Project Logs

Project Logs are the durable account of what was requested, what happened, what was verified, and what remains. They let a new Driver continue useful work without rereading the whole conversation.

## Read the ledger

1. Select the project.
2. Open **Logs** from the tool palette.
3. Use **Search logs** or **Filter by category**.
4. Open an entry.
5. Read its summary, detailed record, authorship, history, and discussion.

In worktrees, the change-scope filter distinguishes **Current worktree**, **Project**, and **All changes**. A record absent from one scope can still exist in another. Check the filter before asking for a duplicate.

Categories are the project's own vocabulary. Priority—Normal, Important, or Urgent—is separate from category.

## Ask for a useful record

The Project Driver writes and revises canonical entries. People can read and comment rather than silently rewriting the ledger.

For example: “Record this task's outcome in the existing Log: what changed, the checks that passed, the browser behavior still unverified, and the next action.”

One coherent task should normally have one evolving entry. As work progresses, the Driver revises it; revision history preserves earlier states. A commit history alone often lacks the user's constraints or unfinished work.

## Correct an entry

Add a comment explaining the correction and evidence. The Driver can incorporate it, ask a clarifying question, or decline with a reason.

The discussion shows states such as **Awaiting Project Driver review**, **Incorporated**, or **Declined**. Posting a comment does not itself change the canonical Log. Read the resulting entry after review.

Learning records are for concepts clarified with the user, not merely discoveries the agent made while investigating code.

## Choose the right surface

Use [Issues](/docs/issues) for concrete actionable work with a lifecycle. Use [Notes](/docs/notes) for reminders and attention items. Use [Knowledge](/docs/knowledge-documents) for maintained reference material.

A Log can link an Issue without duplicating its entire report. A completed task should not become a permanently open reminder merely because it was important.

If posting fails, reconnect and inspect whether the comment or revision already exists before retrying. Keep uncertainty in the record explicit rather than presenting a pending review as a completed correction.
