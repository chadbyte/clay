# Project sharing

Project access determines who can enter an ordinary project. Session visibility determines which conversations inside it they can read. Neither setting publishes the workspace anonymously to the internet.

## Set project visibility

In **Project Settings**, select the parent project, find **Access**, and choose **Manage access and ownership**. Save project access and allowed users separately; each save reports its own result. The same section offers a reviewed ownership transfer.

Alternatively, open the chevron beside the project name in the workspace header and choose **Manage Access**. This opens **Project Access** in account mode.

1. Confirm the exact project and owner.
2. Open **Manage Access** from that project's header menu.
3. Choose **Private** or **Public**.
4. For a private project, select **Allowed Users**.
5. Reopen/check the saved state and have the recipient verify access.

Public ordinary projects are available to authenticated workspace users under the server's rules. Private projects require ownership or an explicit grant. Only the valid owner can change sharing; administrator role alone does not supply content ownership.

If no other users are available, create or invite accounts first. A link cannot substitute for an account grant.

## Set new-session defaults

Open the project header menu, then **Project Settings → Access → New session visibility**. The owner can choose **Private** or **Shared with project members**.

This applies to new ordinary project conversations and Issue **Start work** sessions. Existing sessions, hidden work, and delegated workflows keep their current visibility. Administrators can view the default but cannot change it for another owner.

Worktrees inherit this default from their parent; change it in the parent project.

## Share a particular conversation

Inspect that session's own privacy/sharing controls. A public project does not override a private conversation. Project ownership transfer also does not transfer private session ownership.

For collaborative work, create an appropriately shared conversation and summarize the necessary context there. Keep owner-private Mate or Me information out of it unless deliberately shared.

## Revoke or diagnose

Remove an exact grant when it should no longer apply. Access revocation can close existing connections, and reconnect checks current authorization.

If access persists for a worktree, inspect parent inheritance. An inherited Entire project grant cannot be removed only from a child worktree. See [Worktree sharing](/docs/worktree-sharing).

## Recover missing project ownership

If a project says **Ownership needs recovery**, an administrator can select it in **Project Settings** and use its **Access** section. If you opened the restricted project directly, its **Access** page offers the same checks. Worktree recovery takes place on the parent project.

The restricted overview appears in the workspace's main area. The same project strip and header remain available, while the session list is hidden. Recovery adds no separate navigation or Settings button. Use **Settings** in the header to enter Server Settings even when you cannot open the project's content. Choose **Recover ownership** on the overview to jump to its **Access** page.

Read the check result and the **Proposed recovery owner**, then choose **Recover ownership**. This one click saves the checked owner; no command or approval code is needed. Wait for confirmation, then choose **Reload project**.

An existing valid owner is preserved. If verified system-account evidence identifies the recovery owner, that account is shown. For an orphan private project on a server without OS-user isolation, if no verified account is identified, the authenticated administrator becomes the recovery owner. Public orphan projects use the designated-administrator policy. The panel shows the exact account before you recover the project.

The project directory must exist at its real registered path. Servers with OS-user isolation still require unique verified system-account and directory evidence. Open **Directory and account diagnostics** and use **Copy diagnostic summary** when the operator needs to repair the original mapping, home or directory access, then choose **Check again**. Recovery does not change filesystem ownership.

Recovery updates ownership for the parent and its worktrees. Sharing rules and individual session owners stay unchanged. A changed account, directory, project record or administrator invalidates the check. If a request is interrupted, inspect saved ownership first; recovery is never repeated automatically. A saved change whose runtime publication fails requires operator reload of the saved configuration.

Canonical Clay cannot claim an orphan project through its owner-bound tools. These recovery controls require an authenticated human administrator. System-account provisioning remains an operator task.

For account roles and underlying OS authority, see [Users and roles](/docs/team-users-roles). For conversation privacy, see [Session privacy](/docs/session-privacy-sharing).
