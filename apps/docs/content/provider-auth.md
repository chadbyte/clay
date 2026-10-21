# Provider sign-in

Clay Studio sign-in gives you access to the workspace. A coding-agent login lets that agent contact its provider. Install and authenticate the CLI on the **server machine**, under the OS account that runs it. Signing into a provider website on your phone does not configure the server.

## Set up a first provider: Claude Code

This example uses Claude Code on macOS, Linux, or WSL. Check the [official setup guide](https://code.claude.com/docs/en/setup) for supported systems and Windows installation options.

1. Open a terminal on the server machine.
2. Run the official installer:

```bash
curl -fsSL https://claude.ai/install.sh | bash
```

3. Open a new terminal and run `claude --version`. A version number confirms the command is available. If it is not found, follow the setup guide's PATH instructions.
4. Run `claude auth login` and complete the provider's sign-in flow. Use an account or billing arrangement supported by [Claude Code authentication](https://code.claude.com/docs/en/authentication).
5. Start or return to Clay Studio. In a project, choose **New session → Claude Code → Create**.
6. Choose an offered model and send a short request, such as “Reply with a greeting without changing files.”

A completed response confirms that this session can use the provider. Installing the CLI alone does not establish account access or available usage.

## Other providers

Use the provider's CLI installation guide, rather than installing only its desktop app or editor extension. Alternatives include [Codex](https://learn.chatgpt.com/docs/codex/cli), [OpenCode](https://opencode.ai/docs/), [Kimi Code](https://www.kimi.com/code/docs/en/kimi-code-cli/guides/getting-started.html), [GitHub Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/install-copilot-cli), [Qwen Code](https://qwenlm.github.io/qwen-code-docs/en/users/quickstart/), [Junie CLI](https://junie.jetbrains.com/docs/junie-cli.html), and [Kiro CLI](https://kiro.dev/docs/cli/).

The following commands are the sign-in entry points configured by this Clay Studio version. Some open an interactive application where you finish login. Provider releases can change their setup flow; use their current instructions if your installed command differs.

| Coding agent | Sign-in entry point |
| --- | --- |
| Claude Code | `claude auth login` |
| Codex | `codex login --device-auth` |
| Muse Code | `muse` |
| OpenCode | `opencode auth login` |
| Kimi Code | `kimi login` |
| Grok Build | `grok login --device-auth` |
| GitHub Copilot CLI | `copilot login` |
| Qwen Code | `qwen` |
| Junie CLI | `junie` |
| Kiro CLI | `kiro-cli login` |
| Antigravity CLI | `agy` |

For example, newer Kimi Code instructions start with `kimi` and then `/login` inside it. Check the installed CLI's help before assuming its commands match an older integration. Account plans, model access, and organization policies remain provider-specific.

## If the provider is unavailable

- **Missing from the picker:** check that its executable is installed where the server's OS account can find it. A command available in your personal shell may not be available to a separately launched server.
- **Listed, but sign-in fails:** repeat the provider login under the same OS account. In an OS-isolated installation, another user's credentials do not apply.
- **Model list loads, but a request fails:** read the error for model access, billing, or usage limits. Reinstalling is unlikely to fix an account limit.

Keep credentials in the provider's login flow or settings, not in a conversation. [MCP connections](/docs/mcp-servers) have their own credentials; importing one does not sign the coding agent in.
