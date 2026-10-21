# MCP servers

MCP connections give an agent tools from another service or local program. For example, a connected issue service can let the agent read current requirements instead of relying on pasted text. First connect the service, then enable it where you want to use it; individual actions can still ask for permission.

## Add a remote server

1. Open **MCP / Skills**, then **MCP Servers**.
2. Choose **Add → Remote MCP URL**.
3. Enter the service's actual **Server URL**.
4. Select **Continue**.
5. Complete sign-in if required.
6. Inspect its tool catalog and enable it for the intended scope.

Public HTTPS endpoints are supported by this remote flow. If needed, the connection detail offers **Use an access token → Save and connect**. Enter tokens in that settings form, not in a transcript.

Connection status distinguishes **Ready**, **Saved · connects when used**, **Connecting…**, **Sign-in required**, and **Unavailable**. A saved idle connection is not necessarily broken.

## Inspect tools and permissions

Open a connection's **Tools** tab. Expand a tool to read what it does and the inputs it accepts. The **Permissions** tab offers applicable AI review behavior: session default, AI review, or Ask every time.

Enabling a connection does not approve every tool call. Session permission policy and action-specific authorization still apply.

If the agent cannot see a tool, check that the connection is enabled for the intended conversation and that its provider supports the connection.

## Local and computer connections

**Import vendor config** inspects supported runtime configuration and can produce a disabled local copy after review. See [Imports and skills](/docs/mcp-import-skills).

**On your computer** uses the Clay Studio browser extension. Follow the displayed extension/native bridge instructions, including the generated install command for that extension ID. This is different from a process running on the Clay Studio server.

Computer connections are configured per project. Personal imported and remote connections are for supported owner-private conversations. They are unavailable in shared sessions, and a private session can also lose access after another person's input. Making the session private again does not erase that history. A Worker cannot use personal tools to bypass its Driver's restrictions.

For a personal task, use your own private conversation with the appropriate connection. Keep material you retrieve there private unless you intend to share it.

The Chrome-extension bridge is not available in private Mate conversations. Use the [shared Browser](/docs/browser) there.

## Maintain a connection

Use **Manage connection** to rename or remove a managed connection. Removal disables it and removes saved connection credentials; it does not revoke an external service account by itself.

If sign-in fails, inspect the connection status and provider flow before repeatedly adding duplicates. See [Browser](/docs/browser), [Permissions](/docs/permissions), and [Provider capabilities](/docs/provider-capabilities).
