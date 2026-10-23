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

Worktrees outside the parent directory have a location badge. They remain selectable, and their menu offers the same reviewed removal choices when Git confirms the exact worktree membership.

## Choose a worktree icon

Open the worktree's menu in the project strip and choose **Set Icon**, or open its **Project Settings** and change the icon there. The icon is saved for that worktree across refreshes and server restarts. Changing the parent's icon leaves worktree icons unchanged. Removing a worktree's custom icon restores its branch symbol.

In a shared installation, changing a worktree icon requires the project owner and **Project Settings** permission.

## Share exactly what is needed

Open the worktree's header menu and choose **Manage Access** to open **Worktree Access**.

A private parent can provide **Entire project** access that is inherited automatically. Those checked inherited users cannot be removed from just the child. **People with exact access** identifies grants for this worktree only.

For example, grant a reviewer exact access to a feature worktree without giving them the entire private parent project. Conversely, a person already granted the whole project inherits its worktrees.

If the parent is public, every authenticated user can access the worktree. Exact grants are retained in case the parent later becomes private.

## Session defaults and records

New-session visibility is inherited from the parent project's setting. Change it at the parent; a worktree does not independently override that default.

Project records can have scope filters. In Logs, **Current worktree**, **Project**, and **All changes** distinguish relevant change records from broader project history. Sharing records does not merge filesystem contents.

## Remove carefully

Open the worktree's menu in the project strip. Choose the action that matches what you want to keep:

| Action | Result |
| --- | --- |
| **Exclude worktree (keep files)** | Stops its sessions and Workers and hides the worktree from Clay Studio. Its directory and Git registration remain. The exclusion survives server restarts. |
| **Delete worktree…** | Stops its sessions and Workers, then removes the linked Git worktree and its directory from disk. Keeps the local branch by default; you can explicitly select **Also delete the local branch** in the review. |

Both choices keep stored conversations, shared Issues and Project Logs. Removing the directory does not erase the project's history database or merge its changes.

1. Choose **Exclude worktree (keep files)** or **Delete worktree…**.
2. Check the **Branch** and **Directory** in the confirmation, especially for an externally located worktree.
3. For **Delete worktree…**, leave **Also delete the local branch** unchecked to keep the named branch. Select it only if you also want that local branch deleted; Clay Studio checks the choice again before enabling confirmation. A detached HEAD has no local branch, so this option is absent.
4. Check the updated keep/delete consequence. Choose **Cancel** to leave the worktree and branch untouched, or confirm the named action.
5. Wait for the result. The directory is removed only after runtime shutdown is acknowledged.

In a shared installation, removal requires the project owner and **Delete projects** permission. Deletion refuses changed, untracked, ignored or locked worktrees. Save your changes and move files you want to retain before trying again. There is no forced deletion control.

Optional branch deletion requires that branch to be merged into the retained parent repository’s current HEAD. It refuses the parent’s current branch, a branch checked out in another worktree, or a branch or parent HEAD that changed after review. Keep the branch if you are not ready to merge it. Remote branches are untouched.

Directory and branch deletion are separate steps: the directory is removed first, then the reviewed local branch. If the branch step fails, the directory stays removed and the branch result is reported separately.

If shutdown cannot be confirmed or cleanup fails, Clay Studio keeps a pending operation and reports its operation ID. Ask the server operator to inspect that operation, the actual directory and the named local branch before another attempt; refreshing the page does not retry deletion. A missing directory or an old browser arrangement cannot prove that cleanup completed. There is currently no in-app recovery or restore-exclusion control.

These worktree icon and removal actions use the human product controls. Canonical Clay cannot currently edit worktree icons, exclude worktrees, delete their directories or request the optional local branch deletion through its typed controls.

See [Projects and directories](/docs/projects-working-directories), [Project sharing](/docs/project-sharing), and [File history and Git](/docs/file-history-git).
