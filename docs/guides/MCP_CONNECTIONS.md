# Personal MCP connections

The MCP Servers workbench supports two sources:

- **On your computer:** existing Chrome extension and native bridge. Configure local commands in the extension popup. Clay does not execute those commands on its server.
- **Remote MCP URL:** public HTTPS endpoints using MCP Streamable HTTP. Add the URL, review the discovered tools, then enable it for the current project. A saved connection starts disabled.

Remote connections support unauthenticated endpoints, bearer access tokens, and OAuth with dynamic client registration and PKCE. OAuth opens the same private, human-controlled sign-in viewer used for vendor login. The callback listens on the Clay host's loopback address because the sign-in browser also runs there. No user needs to open that callback on their own device. Browser cookies are discarded after the flow ends; refresh tokens remain in encrypted connection storage.

Servers that require pre-registered OAuth clients, hosted client metadata documents, custom headers, private-network endpoints, or legacy HTTP+SSE transport are not supported in this first version. The screen provides an access-token alternative when the service supports it. Chromium and the host's browser sandbox dependencies are required for browser sign-in.

## Ownership and execution

Configuration and credentials belong to the authenticated Clay account and current project. They are stored under the configured Clay data directory in `mcp-connections`, encrypted with AES-256-GCM and a private server-side key. This protects credentials at rest and against other Clay accounts; it is not isolation from the Clay host administrator.

In multi-user Clay, personal tools are available only to private conversations without another user's input. Workers additionally require an eligible private Driver with the same owner. Shared conversations and unbound helper queries cannot use personal connections. Connection ownership does not depend on whether the user's browser connects through localhost or the network.

Computer calls and results are bound to the exact owning WebSocket. Remote calls recheck live account, session, connection, and enabled state. Disabling takes effect for loaded tool handlers immediately and interrupts the connection; it cannot undo an operation already performed by the remote service. Calls are not replayed after ambiguous network failures.

Enabling a connection does not automatically approve tool calls. Calls retain the active runtime's permission policy. Tool discovery may require the next turn or a new session, depending on the runtime.

## Network and sign-in boundaries

Remote requests require public HTTPS, reject embedded URL credentials and redirects, and use DNS validation at connection time. Browser HTTPS tunnels connect to a checked public IP to prevent DNS rebinding. Private-network browser requests, WebSockets, service workers, and downloads are blocked; the exact OAuth loopback callback is the exception. Sign-in uses random state, PKCE, a one-use callback, issuer checks, cancellation fencing, and a ten-minute lifetime. Browser viewing and input are account-bound and not exposed through agent browser tools.

## Existing configurations

Clay no longer auto-starts host-local definitions from `~/.clay/mcp.json` or injects those definitions into Codex. Existing files are retained. Use the extension/native bridge for computer tools, or add a remote URL in the workbench. Independently configured native agent MCP settings are outside this screen.

Single-user installations retain existing project enable choices for extension servers. Multi-user enable choices are personal and must be made separately; another account's previous project-wide toggle is not inherited. Remote settings persist across browsers and restarts. Computer connections require the extension browser to remain connected.

## Verification

`node --test test/mcp-connections.test.js test/mcp-permission-mode-ui.test.js test/vendor-login-browser.test.js` covers ownership, encrypted persistence, the real MCP client protocol, OAuth exchange and callback validation, schema preservation, immediate disabling, spoofed extension responses, and blocked loopback requests.

`node test/fixtures/mcp-connections-preview.cjs` serves the production UI with clearly labeled sample data for shared-browser layout checks. It does not authenticate with a provider or execute real tools.
