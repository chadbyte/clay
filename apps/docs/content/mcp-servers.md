# MCP servers

MCP connections give an agent tools from another service or local program. For example, a connected issue service can let the agent read current requirements instead of relying on pasted text. First connect the service, then enable it where you want to use it; individual actions can still ask for permission.

Open **MCP / Skills → MCP** to see all your connections. Choose **Add** (or **Add connection** when the list is empty), then select a setup option:

| Option | Use it for |
| --- | --- |
| **Local MCP** | Run an MCP program where Clay Studio is installed, without a browser extension. Includes guided Xcode setup. |
| **Remote MCP URL** | Connect an external service using its HTTPS MCP address. |
| **Import vendor config** | Copy an existing MCP definition from a supported coding agent's configuration on the Clay Studio host. |
| **Client MCP** | Use MCP servers installed on the device you’re connecting from when Clay Studio runs on another machine. Requires the Clay extension and local bridge. |

Connections appear together in the MCP list with their connection type. The **Skills** tab manages reusable agent instructions. Choosing a setup option does not enable an existing connection.

## Add a local MCP server

1. Open **MCP / Skills → MCP → Add → Local MCP**.
2. Enter a **Name** and the executable **Command**, such as `npx`.
3. Enter **Arguments (JSON array)** using the arguments supplied by that MCP server, for example `["-y", "your-mcp-package"]`. Each array entry is passed as one argument; shell quoting is unnecessary.
4. Optionally enter an absolute **Working directory** on the Clay Studio host. The default is your authorized OS account's home directory.
5. Choose **Save connection**. The connection is saved disabled; no program starts yet.
6. Open the saved connection and choose **Test connection** to inspect its tools, then enable it for your private conversations.

Install the program and its dependencies on the machine running Clay Studio. If you access Clay Studio on another machine, Local MCP still runs on its host. Shared installations require an authorized OS user mapping; a sole-account installation can use the account running Clay Studio. Use **Import vendor config** for existing definitions with environment settings and credential references.

## Add a remote server

1. Open **MCP / Skills**, then **MCP**.
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

## Connect Xcode

The **Xcode** preset under **Add → Local MCP** connects directly to Xcode so your agent can use the build, test, and other tools Xcode makes available. No vendor configuration import or browser extension is needed.

Xcode and the Clay Studio server must run on the **same Mac, under the same macOS user**. Opening Clay Studio in a browser on your Mac does not meet this requirement if its server runs elsewhere. You need a full Xcode installation with MCP support and its first-launch setup completed.

1. Open your app project in Xcode.
2. In **Xcode → Settings → Intelligence**, turn on **Allow external agents to use Xcode tools**.
3. Open **MCP / Skills → MCP → Add → Local MCP → Xcode** in Clay Studio. Setup checks the host Mac for the MCP bridge and a running Xcode process.
4. Choose **Connect Xcode**. Approve the connection in Xcode if asked.
5. Confirm that setup shows **Connected** and lists the available tools.
6. In a supported private conversation, ask your agent to inspect the open Xcode project, then build it or run its tests. Tools become available on the next turn; some runtimes need a new session.

Connecting enables the tools for your account's supported private conversations and Mates. The session's tool approval policy still applies. Models remain selected in Clay Studio; this connection supplies Xcode tools.

Use **Check again** after fixing setup problems. The check can detect a missing bridge, license setup issues, or Xcode not running; only a successful connection confirms that its tool catalog is accessible. If the bridge is missing, update Xcode and select the full installation in **Xcode → Settings → Locations → Command Line Tools**. Clay Studio does not change Xcode settings or accept its license for you.

Use **Cancel connection** while connecting, or **Disconnect** after enabling the connection, to block further tool calls. Work already performed in Xcode is not undone. You can remove the saved connection while disconnected. Saved connections appear in the **MCP** list, where you can inspect tool inputs and permissions. If a tool call fails, inspect the result in Xcode before retrying; Clay Studio does not replay the call automatically.

See [Apple's external-agent setup](https://developer.apple.com/documentation/xcode/giving-external-agents-access-to-xcode) for the Xcode-side requirements.

## Client MCP

Choose **Add → Client MCP** when Clay Studio runs on another machine and you want to use MCP servers installed on the device you are accessing it from. This connection uses the Clay browser extension and a local bridge on that device. Local MCP does not require either component.

Follow the displayed extension and bridge instructions, including the generated install command for that extension ID. Add servers in the extension popup; they appear in the MCP list with a **Client MCP** label. Open one to inspect its tools and enable it for this project. **Client MCP setup** returns to setup; use **Refresh connections** after updating the extension or bridge.

Computer connections are configured per project. Personal imported and remote connections are for supported owner-private conversations. They are unavailable in shared sessions, and a private session can also lose access after another person's input. Making the session private again does not erase that history. A Worker cannot use personal tools to bypass its Driver's restrictions.

For a personal task, use your own private conversation with the appropriate connection. Keep material you retrieve there private unless you intend to share it.

The Chrome-extension bridge is not available in private Mate conversations. Use the [shared Browser](/docs/browser) there.

## Maintain a connection

Use **Manage connection** to rename or remove a managed connection. Removal disables it and removes saved connection credentials; it does not revoke an external service account by itself.

If sign-in fails, inspect the connection status and provider flow before repeatedly adding duplicates. See [Browser](/docs/browser), [Permissions](/docs/permissions), and [Provider capabilities](/docs/provider-capabilities).
