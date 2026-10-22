# Server settings and operations

Server Settings apply to the Clay Studio installation and can affect everyone connected. Personal settings apply to your account; project settings apply to a selected project. Clay does not operate Server or User Settings for you.

## Inspect the server

Open **Server Settings → Overview** for host, process, uptime, memory, and current project connection information. Configuration changes require administrator access in account mode.

Use the displayed server URL and port when diagnosing another device. Localhost on the viewing device is not the remote Clay Studio host.

## HTTPS and proxies

Production defaults to HTTPS on port 2633. Startup options choose port and listening address. The following settings address different problems:

| Setting | Use it when |
| --- | --- |
| Allowed external origins | A proxy changes the Host header and the workspace connection is rejected |
| HTTPS & trusted proxies | Account sign-in relies on HTTPS information supplied by your reverse proxy |
| Passkey sign-in address | You are enabling passkeys for a fixed sign-in hostname |

In **Network → Reverse proxy & tunnels**, add **Allowed external origins** when a proxy rewrites the upstream Host. Enter one exact HTTP/HTTPS origin per line, with port where needed, and no path or wildcard. Example: `https://clay.example.com`.

Saving applies to new WebSocket connections. Reconnect to verify. Direct connections and proxies preserving Host normally need no extra origin.

Account transport uses separate **HTTPS & trusted proxies** controls under Access & security. Configure the permanent proxy HTTPS address and exact trusted proxy IPs only when appropriate. Trusted proxies must overwrite forwarded protocol/client address and prevent direct public backend access. Forwarded headers are not trusted automatically.

Passkeys have a separate exact **Passkey sign-in address**. Network allowlisting does not expand passkey trust.

## Email delivery

For invitations and login email, open **Server Settings → Email delivery** and configure SMTP. Follow [Personal email and SMTP](/docs/email) for host, port, TLS, and test-delivery steps. This connection does not give an assistant access to a personal inbox.

## Storage and retention

Open **Storage** and select **Refresh usage** for a new measurement. Read timestamps and partial/unavailable indicators. Cached results can be up to five minutes old; unavailable does not mean zero bytes.

Usage can attribute registered projects to owners or mapped Linux identities. Shared, nested, conflicting, and skipped paths affect totals. Image retention controls govern supported stored images, not a complete repository backup.

## Update, restart, and stop

In **Operations**, inspect Software updates and choose **Update now** when intended. **Restart** interrupts active work and reconnects browsers. **Danger zone** shutdown stops the server for everyone; starting again requires host access.

Before maintenance, inspect active sessions, queues, and scheduled runs. Afterward, verify the server version, provider readiness, and unfinished work rather than assuming interrupted actions replay safely.

## Back up and recover

There is no general backup/restore button implied by Storage. For an operator backup, stop Clay Studio for a consistent copy and preserve its configured data directory, registered project directories, provider-required state, and relevant configuration using your host backup system.

The default data location is `~/.clay`; `CLAY_HOME` can change it. Development uses separate state. Store backups securely because they can contain private history and credentials. Test restoration in an isolated environment before replacing live data, and never run two active writers against the same data store.

See [CLI flags](/docs/cli-flags), [Account security](/docs/account-devices-security), and [Troubleshooting](/docs/troubleshooting).
