# Fork and rewind

Forking creates another conversation path. Rewinding returns an existing session to a selected point using the capabilities available for its runtime. Neither operation should be treated as a general backup system.

## Fork an investigation

Use **Fork** on the relevant message when you want to explore another approach while keeping the original conversation.

1. Find the turn containing the context you want.
2. Choose its **Fork** action.
3. Wait for the new session to appear.
4. Check the copied history boundary and current provider.
5. State the alternative task explicitly.

Example: “Explore an implementation without changing the public API. Inspect the current files before proposing edits.”

A fork is another conversation, not automatically a separate Git branch or worktree. Both sessions can still edit the same directory. Use [worktrees](/docs/worktree-sharing) when the alternatives need isolated files.

History boundaries depend on the runtime. Review what the new transcript actually contains, particularly around incomplete turns or provider-native task activity.

## Rewind a session

Stop active processing first. Where rewind is offered:

1. Select **Rewind** on a turn, or enter rewind mode and select a message.
2. Wait for the preview.
3. Inspect the listed paths and diffs.
4. Choose the offered conversation/file mode.
5. Confirm only after checking the selected session and checkpoint.
6. Inspect both the resulting transcript and working tree.

The preview distinguishes conversation-only behavior from file restoration. Conversation-only rewind leaves files unchanged. File restoration applies to the available recorded checkpoint and listed changes; it does not promise to undo every shell command, untracked file, external service action, or edit by another process.

A preview can report **No file changes to restore** or **No diff available**. Those messages are limits of the recorded evidence, not proof that the entire directory equals an earlier state.

## Recover cautiously

If rewind is unavailable, the provider or turn may lack a usable checkpoint. Preserve current changes and use Git or an explicit corrective edit instead.

If an operation errors or disconnects, inspect its observed result before retrying. Never assume rewinding a message recalls a sent email or reverts a remote deployment. See [File history and Git](/docs/file-history-git), [Stop and recovery](/docs/stop-recovery), and [Provider capabilities](/docs/provider-capabilities).
