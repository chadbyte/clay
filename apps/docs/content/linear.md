# Linear

Clay Studio can link a conversation to a Linear issue so its requirements, status, and related work stay together. This depends on a working native Linear connection. Linear's official MCP service is a separate way for an assistant to read or update issues.

## Current connection limitation

**Saving a new named Linear connection does not currently assign it to Clay Studio's native session tools.** There is no assignment control in the current UI. A saved key or **Not assigned** state therefore does not mean native issue search and linking are ready to use.

An existing legacy connection may still support those features. If native access is unavailable, use authorized Linear MCP tools for the work itself, or supply the issue details in the conversation. MCP access alone does not create Clay Studio's linked badges or related-conversation records.

## Manage a saved named connection

1. Open **Settings → Personal → Integrations**.
2. Under **Available integrations**, choose **Linear**.
3. Enter a **Connection name** and your own **Personal API key**.
4. Choose **Save connection**.
5. Check the entry under **Your connections**.

This saves credentials, subject to the limitation above. **Manage** lets you rename the connection or replace its key; leaving the key blank keeps the saved value. Disconnect removes the connection while retaining existing issue links. Enter keys only in settings, never in chat.

## Read and link when native access works

Give the assistant an issue URL or identifier: “Read CLAY-123 and check for existing linked work before implementing it.” If several issues match, choose the intended one.

Open the Linear side panel to read requirements, comments, and **Linked conversations**. **Link this conversation** and **Unlink this conversation** manage the current session's association. Linking does not post a comment or change Linear, but issue titles and status are visible to people who can view the Clay Studio conversation.

Use **Make primary** in linked work to emphasize one issue. Adding another link does not replace a saved primary. If a GitHub PR implements the issue, link both so the relationship is easy to follow.

## Use official Linear MCP

Linear publishes its remote MCP service at `https://mcp.linear.app/mcp`. It supports reading and writing Linear objects after authorization. Follow [Linear's official MCP setup instructions](https://linear.app/docs/mcp) for your client, or use Clay Studio's [remote MCP connection flow](/docs/mcp-servers) with that URL and complete sign-in.

Ask the assistant to check which tools are actually available before requesting an update. For example: “Read this issue and draft a clarification comment for me to review.” Send or publish only when you intend that action. A draft remains useful even when the connected tools cannot post it.

For native access failures, distinguish the connection limitation above from an issue in another workspace or one your account cannot read. Repeatedly saving another named key does not resolve assignment.
