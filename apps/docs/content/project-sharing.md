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

1. Read the ownership check result. It identifies an unavailable directory, missing account mapping, or ambiguous system identity.
2. Open **Server operator instructions**. The operator must verify or restore the original account's system-user mapping, real home and directory ownership on the system running Clay Studio. **Copy diagnostic summary** copies the project identifier and check result without private paths or credentials.
3. Choose **Check again** after the operator repairs the underlying problem.
4. When the checks identify a verified owner, choose **Review recovery**, check that owner, then **Recover ownership**.
5. Wait for confirmation and choose **Reload project** to refresh your access.

Recovery saves ownership for the parent and its worktrees. It preserves sharing rules and individual session owners. Private projects require unique verified system-account and directory evidence; an administrator cannot select an arbitrary replacement owner. Public orphan projects use the same designated-administrator policy as startup recovery.

A changed account, directory or project record invalidates the review. Check again before another attempt. If a request is interrupted, inspect the saved ownership first; the interface does not automatically repeat recovery. A saved change whose runtime publication fails requires operator reload of the saved configuration.

Canonical Clay's project controls require a verified project owner, so they cannot claim an orphan project. Recovery checks and confirmation are currently available through authenticated human administrator controls. System-account provisioning remains an operator task.

For account roles and underlying OS authority, see [Users and roles](/docs/team-users-roles). For conversation privacy, see [Session privacy](/docs/session-privacy-sharing).
