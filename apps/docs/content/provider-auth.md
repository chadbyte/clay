# Provider sign-in

Clay Studio sign-in gives you access to the workspace. A coding-agent login lets that agent contact its provider. Install and authenticate the CLI on the **server machine**, under the OS account that runs it. Signing into a provider website on your phone does not configure the server.

## Manage providers in Personal settings

Open **Settings → Personal → AI providers**. The sidebar anchors jump through one continuous page: **Coding agents**, **AI defaults**, **Execution & permissions**, **API connections** and **Experimental features**. Thin dividers separate these groups. On a narrow screen, choose **AI providers** in the settings page selector, then use the sticky section-anchor row within the page. Scrolling updates the selected section.

**Coding agents** lists every registered coding agent, with separate installation, authentication and test states. **Installed** means Clay Studio found the runtime executable; it does not confirm sign-in, model entitlement or a successful request. Authentication is shown as unknown when no live result is available. After the supported sign-in flow reports success, its row shows **Sign-in reported success · Not tested**, with an informational message asking you to retry your task explicitly. This does not verify a model request. **Refresh status** checks installations again and resets the temporary sign-in result to unknown.

Check the account name and shared or mapped OS account shown above the rows. Expand **Runtime details** to inspect the exact UID and **HOME**; the sign-in editor and installation review also show their runtime HOME. On an OS-isolated server this is your mapped OS account. On a shared server, provider credentials belong to the server process's HOME and can affect other processes using that HOME. Personal settings does not make those credentials private to each Clay Studio account.

For an installed provider, choose **Manage → Sign in**, or **Use terminal sign-in** where offered. The supported browser or terminal coordinator opens for the selected provider and your runtime identity, regardless of the conversation you are viewing. Terminal permission is required. **Cancel sign-in**, leaving the provider page, disconnecting or losing access ends that settings sign-in. Reopen the page and refresh status before trying again. Sign-in never sends or replays a task; deliberately retry the task when you are ready.

For a missing Claude Code or Codex installation, **Install → Review installation** is available on macOS 13 or later and Linux, on x64 or ARM64, when your runtime account is non-root and you have terminal permission. Review the exact OS account, UID, HOME, command and effects, then choose **Install for this account**. A mapped account installs only into its own runtime environment. On a shared server, only the administrator can install into the shared HOME. The review expires after two minutes; leaving settings cancels it.

Claude Code uses its official native installer, which writes under `~/.local` and enables native auto-updates. Codex uses the official `@openai/codex@latest` npm package with an explicit `~/.local` prefix and a separate cache. Codex requires Node.js and npm on the runtime PATH. The installer does not edit your shell profiles: `~/.local/bin` must be on the runtime PATH for discovery and sign-in. These commands download current provider software and run its installation code as the reviewed OS account.

The page reports when installation starts and when its terminal exits. A successful exit and a discovered runtime are separate results; neither proves authentication. **Stop installation**, leaving settings, disconnecting, or losing the bound identity or permission stops the installation terminal. Installation context expires after five minutes. Partial files may remain. Refresh status before explicitly reviewing another attempt. If launch or shutdown cannot be confirmed, the installation stays blocked in that server process; ask the operator to inspect and recover the runtime before restarting the server. Nothing retries automatically.

Other providers, unsupported systems, root runtimes and accounts without permission show **Setup instructions** with the reason and a link to the provider’s official setup guide. Providers without mapped OS-account support do not borrow the shared server account's installation or credentials. Provider logout is unavailable here.

**API connections** holds audio transcription keys separately from coding-agent sign-in. See [Voice input](/docs/mentions-voice-slash#dictate-a-request) to add or remove one. These Personal settings operations are available through human controls; Clay's canonical product tools cannot inspect keys, install providers or sign in for you.

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

## Sign in when a session needs it

When a live session reports that it needs authentication, Clay Studio opens the provider's supported sign-in window. Providers with browser sign-in open a private browser; **Use terminal sign-in** switches to the provider's terminal flow. Other providers use their registered terminal sign-in entry point. If automatic sign-in is unavailable or your account lacks terminal permission, follow the manual setup steps above under the correct server OS account.

This also applies to a current Split Worker while you are viewing its Driver, even when the Worker's conversation is closed or it uses another provider. The window belongs to the Worker's provider and account. Your selected conversation stays in place.

After signing in, explicitly ask the Driver to retry the Worker task. Sign-in refreshes supported provider runtimes but does not resend delegated work. Canceling sign-in preserves the Worker and its history. Reopening history or reconnecting does not create a new sign-in request; retry the task deliberately if you still need access.

## If the provider is unavailable

- **Missing from the picker:** check that its executable is installed where the server's OS account can find it. A command available in your personal shell may not be available to a separately launched server.
- **Listed, but sign-in fails:** repeat the provider login under the same OS account. In an OS-isolated installation, another user's credentials do not apply.
- **Model list loads, but a request fails:** read the error for model access, billing, or usage limits. Reinstalling is unlikely to fix an account limit.

Keep credentials in the provider's login flow or settings, not in a conversation. [MCP connections](/docs/mcp-servers) have their own credentials; importing one does not sign the coding agent in.
