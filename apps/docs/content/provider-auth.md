# Authenticate coding-agent providers

Signing in to Clay Studio establishes workspace access. Signing in to a coding-agent runtime establishes provider access. You generally need both. Installations and credentials belong to the server environment, not to whichever browser opens Clay Studio.

## Check the environment

1. Confirm which machine and OS account run Clay Studio.
2. Open the provider picker when creating a session.
3. If the provider is unavailable, install its CLI where Clay Studio can discover it.
4. Complete provider sign-in under the appropriate OS account.
5. Return to Clay Studio and make a short request.

An installed entry proves discovery, not successful authentication or an available subscription. With OS user isolation, credentials from another server user do not automatically apply.

## Sign in

Clay Studio offers browser sign-in assistance for integrations that expose it. Follow the provider's actual authentication page. Other runtimes use their terminal flow. These are the login commands identified by the installed integrations:

| Runtime | Command |
| --- | --- |
| Claude Code | `claude auth login` |
| Codex | `codex login --device-auth` |
| OpenCode | `opencode auth login` |
| Kimi Code | `kimi login` |
| Grok Build | `grok login --device-auth` |
| GitHub Copilot CLI | `copilot login` |
| Qwen Code | `qwen` |
| Junie CLI | `junie` |
| Kiro CLI | `kiro-cli login` |
| Antigravity CLI | `agy` |

Some commands open an interactive application containing its own sign-in steps. The provider may require model entitlements beyond authentication. Enter credentials only in the provider or settings flow, not in a project conversation.

## Verify access

Create a session, load its model catalog, choose an offered model, and send a simple text request. A completed response is stronger evidence than the presence of credential files.

If authentication expires, sign in again under the same account and retry deliberately. If the executable is missing, correct installation or the daemon environment first. If login succeeds but requests are rate-limited, inspect the provider's usage information.

MCP connection credentials are separate. Importing MCP configuration does not sign the coding agent in. See [MCP servers](/docs/mcp-servers), [Models](/docs/models-and-providers), and [Provider capabilities](/docs/provider-capabilities).
