# Project sharing

Project access determines who can enter an ordinary project. Session visibility determines which conversations inside it they can read. Neither setting publishes the workspace anonymously to the internet.

## Set project visibility

Use the project's access control, or the authorized **Project access** settings surface.

1. Confirm the exact project and owner.
2. Open **Project Access**.
3. Choose **Private** or **Public**.
4. For a private project, select **Allowed Users**.
5. Reopen/check the saved state and have the recipient verify access.

Public ordinary projects are available to authenticated workspace users under the server's rules. Private projects require ownership or an explicit grant. Only the valid owner can change sharing; administrator role alone does not supply content ownership.

If no other users are available, create or invite accounts first. A link cannot substitute for an account grant.

## Set new-session defaults

Open **Project settings → Access → New session visibility**. The owner can choose **Private** or **Shared with project members**.

This applies to new ordinary project conversations and Issue **Start work** sessions. Existing sessions, hidden work, and delegated workflows keep their current visibility. Administrators can view the default but cannot change it for another owner.

Worktrees inherit this default from their parent; change it in the parent project.

## Share a particular conversation

Inspect that session's own privacy/sharing controls. A public project does not override a private conversation. Project ownership transfer also does not transfer private session ownership.

For collaborative work, create an appropriately shared conversation and summarize the necessary context there. Keep owner-private Mate or Me information out of it unless deliberately shared.

## Revoke or diagnose

Remove an exact grant when it should no longer apply. Access revocation can close existing connections, and reconnect checks current authorization.

If access persists for a worktree, inspect parent inheritance. An inherited Entire project grant cannot be removed only from a child worktree. See [Worktree sharing](/docs/worktree-sharing).

If the UI says **Ownership needs recovery**, content stays disabled until authoritative ownership can be established. Do not create another registration through an alias or symlink to bypass that state.

For account roles and underlying OS authority, see [Users and roles](/docs/team-users-roles). For conversation privacy, see [Session privacy](/docs/session-privacy-sharing).
