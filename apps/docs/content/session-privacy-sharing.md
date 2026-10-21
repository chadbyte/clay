# Session privacy and sharing

Project access lets someone enter a project; session visibility determines which conversations they can read there. A public project can contain private sessions. Public access is within the authenticated Clay Studio workspace, not an anonymous internet page.

## Share a project conversation

In an account-mode installation, the owner of an ordinary project session can change its visibility:

1. Select the project and find the session in the sidebar.
2. Right-click its row to open the session menu.
3. Choose **Make Shared** to share it with project members, or **Make Private** to restrict it again.
4. Check the updated session state. Shared sessions have a **Shared session** indicator.
5. Ask the intended recipient to open it using their own account.

These controls do not apply to Mate conversations. If the menu is absent, check that you own the session and are using an ordinary project in account mode.

The recipient also needs [project access](/docs/project-sharing). A copied session link does not grant that access. Project ownership transfer does not transfer ownership of private conversations.

## Choose defaults for new sessions

Open the project's header menu, then **Project Settings → Access → New session visibility**. The owner can choose **Private** or **Shared with project members**. The setting governs new ordinary sessions; it does not change existing conversations. Worktrees inherit the default from their parent project.

## Bring private work into a shared task

Create a shared project session and summarize only the context you intend to share. Clay and other Mate conversations remain private to their owner, as does [Me](/docs/mate-knowledge-memory-me).

Personal connected tools can become unavailable when a session is shared or includes another person's input, even if its visibility later becomes private. See [MCP connections](/docs/mcp-servers).

## If someone cannot open the conversation

Check their signed-in account, project access, and the session's visibility in that order. Administrator status alone does not allow reading another person's private conversation. Revoking access can disconnect an existing viewer; reconnecting checks the current permissions.
