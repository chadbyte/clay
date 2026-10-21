# Worktrees and sharing

A Git worktree is a separate working directory for the same repository. Use it for parallel changes that need independent branches and files. A split View only arranges conversations; it does not provide this isolation.

## Create and use a worktree

1. Open the chevron beside the parent project's name in the workspace header.
2. Choose **Add Worktree**.
3. Enter **Branch name**, such as `feat/export-validation`.
4. Choose **Base branch**, select **Create**, and wait for the result.
5. Open the new worktree under its parent.
6. Verify the directory and branch before starting a session.

Use one worktree for a feature and another for a conflicting fix. Commit and integration remain separate Git actions; creating a worktree does not merge its eventual changes.

Externally located worktrees can be marked separately. Read the location/status rather than assuming every child directory is managed identically by Clay Studio.

## Share exactly what is needed

Open the worktree's header menu and choose **Manage Access** to open **Worktree Access**.

A private parent can provide **Entire project** access that is inherited automatically. Those checked inherited users cannot be removed from just the child. **People with exact access** identifies grants for this worktree only.

For example, grant a reviewer exact access to a feature worktree without giving them the entire private parent project. Conversely, a person already granted the whole project inherits its worktrees.

If the parent is public, every authenticated user can access the worktree. Exact grants are retained in case the parent later becomes private.

## Session defaults and records

New-session visibility is inherited from the parent project's setting. Change it at the parent; a worktree does not independently override that default.

Project records can have scope filters. In Logs, **Current worktree**, **Project**, and **All changes** distinguish relevant change records from broader project history. Sharing records does not merge filesystem contents.

## Remove carefully

Open the worktree's menu and choose **Remove Worktree**. In the managed-worktree deletion flow, the confirmation warns that the branch and working directory will be removed from disk. Preserve uncommitted changes and stop work that uses the directory before confirming. This is more destructive than merely unregistering an ordinary project.

Externally managed worktrees can have restricted removal controls. Do not use a manual directory delete as a substitute without understanding Git's worktree state.

If a path becomes unavailable, confirm its actual location and OS access. An old browser arrangement cannot restore a deleted working directory.

See [Projects and directories](/docs/projects-working-directories), [Project sharing](/docs/project-sharing), and [File history and Git](/docs/file-history-git).
