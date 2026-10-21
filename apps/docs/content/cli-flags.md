# CLI reference

Run the CLI on the machine that hosts Clay Studio. It starts or controls the daemon; it is not a command sent through an agent conversation. Node.js 20 or newer is required.

## Common commands

```bash
npx clay-server
npx clay-server -p 8080
npx clay-server --add .
npx clay-server --list
npx clay-server --remove /path/to/project
npx clay-server --restart
npx clay-server --shutdown
```

Add, remove, and list address the running daemon. Add resolves the supplied directory; remove unregisters the matching project. They are not repository clone or filesystem-delete commands. Restart and shutdown affect everyone on that daemon.

## Supported options

| Option | Purpose |
| --- | --- |
| `-h`, `--help` | Print usage and exit |
| `-p`, `--port <port>` | Listening port; production default 2633 |
| `--host <address>`, `--bind <address>` | Bind address; default 0.0.0.0 |
| `--no-https` | Disable default HTTPS |
| `--local-cert` | Use local mkcert certificate and suppress migration notice |
| `--builtin-cert` | Use built-in certificate even if mkcert is installed |
| `--no-update`, `--skip-update` | Skip startup update check |
| `--debug` | Enable the web debug panel |
| `-y`, `--yes` | Accept default interactive choices |
| `--pin <pin>` | Set a six-digit PIN, typically with --yes |
| `--headless` | Start the daemon and exit; implies --yes |
| `--multi-user` | Start in account mode |
| `--os-users` | Linux OS-user isolation; requires root and multi-user mode |
| `--dangerously-skip-permissions` | Bypass routine agent permission prompts |
| `--add <path>` | Register a directory with the running daemon |
| `--remove <path>` | Remove a registration from the running daemon |
| `--list` | List registered projects |
| `--restart` | Restart the running daemon |
| `--shutdown` | Stop the running daemon |

Permission bypass does not remove Clay Studio account/project access restrictions or replace required product reviews. Account-mode sign-in policy is separate from the legacy Server PIN.

## Unattended startup

```bash
npx clay-server --headless --multi-user -p 2633
```

Complete the actual administrator setup flow and use the printed address. Headless does not mean anonymous access or that providers have been authenticated.

Use `CLAY_HOME` to select a data location when intentionally managing an independent installation. Preserve configuration and avoid concurrent writers to the same data store.

## Development-only options

`--dev` uses development state, default port **2635**, debug mode, and skips update checks. `-w` / `--watch` enables the CLI's watch mode. These are Clay Studio application development controls.

If the installed version differs, run its `--help` and check the observed behavior. See [Server settings](/docs/server-settings) for network and operations details.
