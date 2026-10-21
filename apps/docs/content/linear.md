# Linear

Clay Studio reads Linear issues and links them to conversations. Linked badges, the issue side panel, and related conversations help preserve work context. Saving a personal key and providing issue access to a particular workflow remain distinct.

## Save a personal connection

1. Open **Settings → Personal → Integrations**.
2. Under **Available integrations**, choose **Linear**.
3. Enter a **Connection name**, such as Work or Client.
4. Enter your own **Personal API key**.
5. Choose **Save connection**.
6. Check the saved connection and workspace under **Your connections**.

This surface supports named connections. A **Key saved** state confirms saved credentials; **Not assigned** does not mean every project or workflow is using that key. Do not assume a newly named connection replaces an existing default integration.

Choose **Manage** to rename or replace a key. Leaving the key blank retains the saved key. Disconnect removes that connection while retaining existing issue links.

Never paste API keys into a conversation or borrow another person's credentials.

## Read and link

Give the assistant an exact issue URL or identifier: “Read CLAY-123 and check for existing linked work before implementing it.” Choose the intended issue when a description matches several possibilities.

Open the Linear side panel to read requirements, comments, and **Linked conversations**. Use **Link this conversation** or **Unlink this conversation** for the current session.

Linking stores Clay Studio metadata. It does not post a comment or change Linear. Issue titles and status become visible to people who can view the Clay Studio conversation.

If access fails, check the connection used by that workflow and the issue's workspace/permissions. A saved key alone is not proof that the target issue is accessible.

## Primary work

Use **Make primary** in linked work to emphasize an issue. Adding or refreshing another link does not replace a saved primary automatically. An assistant-driven primary change needs your explicit request and the exact review.

When a GitHub PR implements the issue, link both verified URLs. A branch name alone does not establish the relationship.

## Write operations

Creating issues, changing status/assignee, and posting comments require authorized tools supporting those operations. Clay Studio's personal API-key setup does not automatically configure official Linear MCP.

If suitable MCP tools are available, the assistant can use them within your request. Otherwise it can prepare a draft and state that nothing was posted. Use [Linear's MCP documentation](https://linear.app/docs/mcp) for your actual agent client.

See [GitHub](/docs/github), [MCP servers](/docs/mcp-servers), and [Project sharing](/docs/project-sharing).
