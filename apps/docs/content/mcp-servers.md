# MCP servers

MCP connections give an eligible agent tools supplied by another service or local process. Connecting a server, enabling it for a session, and approving a tool action are separate steps.

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

Open a connection's **Tools** tab. Expand a tool to read its description and input schema. The **Permissions** tab offers applicable AI review behavior: session default, AI review, or Ask every time.

Enabling a connection does not approve every tool call. Session permission policy and action-specific authorization still apply.

If a tool is absent from the agent's current catalog, check connection scope, runtime support, and session refresh/resume behavior. Do not assume all providers mount tools identically.

## Local and computer connections

**Import vendor config** inspects supported runtime configuration and can produce a disabled local copy after review. See [Imports and skills](/docs/mcp-import-skills).

**On your computer** uses the Clay Studio browser extension. Follow the displayed extension/native bridge instructions, including the generated install command for that extension ID. This is different from a process running on the Clay Studio server.

Computer preferences are project-scoped. Imported and remote personal connections are available to eligible private sessions and Mates. In multi-user Clay Studio, shared conversations cannot use personal connections.

The Chrome-extension bridge is not available to private Mate sessions because it lacks a private Mate target; use the shared Browser for Mate browsing.

## Maintain a connection

Use **Manage connection** to rename or remove a managed connection. Removal disables it and removes saved connection credentials; it does not revoke an external service account by itself.

If sign-in fails, inspect the connection status and provider flow before repeatedly adding duplicates. See [Browser](/docs/browser), [Permissions](/docs/permissions), and [Provider capabilities](/docs/provider-capabilities).
