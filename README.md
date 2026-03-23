# Clay

<p align="center">
  <img src="media/phone.gif" alt="Clay on phone" width="300">
</p>

<h3 align="center">Turn Claude Code into a team workspace. Any device, one command.</h3>

[![npm version](https://img.shields.io/npm/v/clay-server)](https://www.npmjs.com/package/clay-server) [![npm downloads](https://img.shields.io/npm/dw/clay-server)](https://www.npmjs.com/package/clay-server) [![GitHub stars](https://img.shields.io/github/stars/chadbyte/clay)](https://github.com/chadbyte/clay) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/chadbyte/clay/blob/main/LICENSE)

Clay gives Claude Code a browser UI that runs on any device. Use it from your phone, run it on macOS, Windows, or Linux. Invite teammates, manage multiple projects from one sidebar, and get push notifications when Claude needs you. HTTPS and push notifications work out of the box with zero config. Built on the official Claude Agent SDK, not a terminal parser. Your machine is the server. No cloud relay in between, no extra network surface.

---

## Getting Started

**Requirements:** Node.js 20+, Claude Code CLI (authenticated).

```bash
npx clay-server
```

On first run, it walks you through port and PIN setup.
Scan the QR code to connect from your phone instantly.

For remote access, use a VPN like Tailscale.

<p align="center">
  <img src="media/start.gif" alt="Clay starting from CLI" width="600">
</p>

---

## Multi-session, multi-project

Add a project in the browser and an agent attaches to it.
Run backend, frontend, and docs simultaneously. Switch between them in the sidebar.

The server runs as a background daemon. Sessions persist even after you close the terminal.

Mermaid diagrams render as diagrams. Tables render as tables.
Code blocks highlight 180+ languages.
Browse project files in the file browser — changes reflect live while the agent works.

<p align="center">
  <img src="media/split.gif" alt="split-screen workflow" width="700">
</p>

---

## Multi-user

Invite teammates and give them access to a project. They talk to Claude Code directly in the browser — no terminal, no setup on their end.

Add a CLAUDE.md and the AI operates within those rules: explains technical terms in plain language, escalates risky operations to seniors, summarizes changes in simple words.

If someone gets stuck, join their session to unblock them in real time. Permissions can be separated per project and per session. Real-time presence shows who's where.

---

## Mates

Build your team, even if you're solo.

Mates are AI teammates you create through conversation. Interview them, give them a name, avatar, and role. A code reviewer, a marketing lead, a writing partner. They remember how you work together and carry context across sessions.

They sit in your sidebar next to your human teammates. DM them, bring them into projects, let them work autonomously. In a multi-user workspace, your whole team, human and AI, works in one place.

<!-- screenshot: sidebar with Mates visible -->

---

## Mobile & notifications

Phone, tablet, couch. All you need is a browser.
Pick up a terminal session in the browser. Continue a browser session from another device.
One QR code to connect. Install as a PWA for a native-like experience.

When Claude asks for approval, your phone buzzes. You also get notified on completion or error. No need to keep the browser open.

<p align="center">
  <img src="media/push-notification.jpg" alt="push notification" width="300">
</p>

---

## Automation

The scheduler kicks off agents at set times.
Have it check open issues and submit PRs every morning at 8 AM.
Or compile world news and email you a digest every day.

Take it further with Ralph Loop, an autonomous coding loop built into Clay. The agent works, commits, and a judge evaluates. If it fails, a fresh session starts over with no memory of the previous attempt. Only the code carries over. Based on [Geoffrey Huntley's Ralph Wiggum technique](https://ghuntley.com/loop/).

---

## Security & Privacy

Your data flows directly from your machine to the Anthropic API, exactly as it does when you use the CLI. Clay adds a browser layer on top, not a middleman.

HTTPS is enabled by default with a builtin certificate. PIN authentication and per-project/session permissions are built in. For local network use, this is sufficient. For remote access, we recommend a VPN like Tailscale.

---

## Why Clay?

*As of March 2026.*

| | CLI + Remote Control | tmux | Desktop | Cowork | **Clay** |
|---|---|---|---|---|---|
| Multi-user | ❌ | ✅ | ❌ | ❌ | ✅ |
| Mobile / PWA | ✅ | ➖ | ➖ | ➖ | ✅ |
| Push notifications | 🟠 | ❌ | 🟠 | ❌ | ✅ |
| GUI | 🟠 | ❌ | ✅ | ✅ | ✅ |
| Scheduler (cron) | 🟠 | ❌ | ✅ | ✅ | ✅ |
| Scheduler survives logout | ❌ | ➖ | 🟠 | 🟠 | ✅ |
| Join teammate's session | ❌ | 🟠 | ❌ | ❌ | ✅ |

✅ Supported · 🟠 Partial / limited · ❌ Not supported · ➖ N/A

---

## Key Features

* **Mates** - AI teammates with persistent identity, context, and memory. Create through an interview, DM them, collaborate across sessions.
* **Multi-user** - Accounts, invitations, per-project/session permissions, real-time presence.
* **Multi-agent** - Parallel agents per project, sidebar switching.
* **Push notifications** - Approval, completion, error. Native-like PWA experience.
* **Scheduler** - Cron-based automatic agent execution.
* **Ralph Loop** - Autonomous coding loop. The agent works, a judge evaluates, and it iterates until it passes.
* **File browser** - File exploration, syntax highlighting, live reload.
* **Built-in terminal** - Multi-tab terminal, mobile keyboard support.
* **Session search** - Full-text search across all conversation history.
* **Session persistence** - Survives crashes, restarts, and network drops.

---

## FAQ

**"Is this just a terminal wrapper?"**
No. Clay runs on the Claude Agent SDK. It doesn't wrap terminal output. It communicates directly with the agent through the SDK.

**"Does my code leave my machine?"**
The Clay server runs locally. Files stay local. Only Claude API calls go out, which is the same as using the CLI.

**"Can I continue a CLI session?"**
Yes. Pick up a CLI session in the browser, or continue a browser session in the CLI.

**"Does my existing CLAUDE.md work?"**
Yes. If your project has a CLAUDE.md, it works in Clay as-is.

**"Does each teammate need their own API key?"**
No. Teammates share the Claude Code session logged in on the server. If needed, you can configure per-project environment variables to use different API keys.

**"Does it work with MCP servers?"**
Yes. MCP configurations from the CLI carry over as-is.

**"What are Mates?"**
AI teammates you create through a conversation. Each Mate has a name, avatar, personality, and persistent memory. They live in your sidebar and you can DM them or bring them into projects.

**"How is a Mate different from Claude Projects?"**
Claude Projects save prompts and files as context. A Mate is a teammate. It has its own identity formed through an interview, remembers how you work together across sessions, and exists alongside your human teammates in the workspace. You're not organizing prompts. You're building a team.

**"Can I create multiple Mates?"**
Yes. Create as many as you need. A code reviewer, a writing partner, a project manager. Each one is independent.

---

## HTTPS

HTTPS is enabled by default using a builtin wildcard certificate for `*.d.clay.studio`. No setup required. Your browser connects to a URL like:

```
https://192-168-1-50.d.clay.studio:2633
```

The domain resolves to your local IP. All traffic stays on your network. See [clay-dns](clay-dns/) for details on how this works.

Push notifications require HTTPS, so they work out of the box with this setup. Install Clay as a PWA on your device to receive them.

<details>
<summary><strong>Alternative: local certificate with mkcert</strong></summary>

If you prefer to use a locally generated certificate (e.g. air-gapped environments where DNS is unavailable):

```bash
brew install mkcert
mkcert -install
npx clay-server --local-cert
```

This generates a self-signed certificate trusted by your machine. The setup wizard will guide you through installing the CA on other devices.

</details>

---

## CLI Options

```bash
npx clay-server              # Default (port 2633)
npx clay-server -p 8080      # Specify port
npx clay-server --yes        # Skip interactive prompts (use defaults)
npx clay-server -y --pin 123456
                              # Non-interactive + PIN (for scripts/CI)
npx clay-server --no-https   # Disable HTTPS
npx clay-server --local-cert # Use local certificate (mkcert) instead of builtin
npx clay-server --no-update  # Skip update check
npx clay-server --debug      # Enable debug panel
npx clay-server --add .      # Add current directory to running daemon
npx clay-server --add /path  # Add project by path
npx clay-server --remove .   # Remove project
npx clay-server --list       # List registered projects
npx clay-server --shutdown   # Stop running daemon
npx clay-server --dangerously-skip-permissions
                              # Bypass all permission prompts (requires PIN at setup)
npx clay-server --dev        # Dev mode (foreground, auto-restart on lib/ changes, port 2635)
```

---

## Architecture

Clay drives Claude Code execution through the [Claude Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) and streams it to the browser over WebSocket.

```mermaid
graph LR
    Browser["Browser<br/>(Phone / Desktop)"]
    WS["WebSocket"]
    Server["HTTP Server<br/>lib/server.js"]
    Project["Project Context<br/>lib/project.js"]
    SDK["Claude Agent SDK"]
    Claude["Claude Code<br/>Process"]
    Push["Push Service"]

    Browser <-->|Real time stream| WS
    WS <--> Server
    Server -->|slug routing| Project
    Project <-->|async iterable| SDK
    SDK <-->|Prompt / Response| Claude
    Project -->|Approval request| Push
    Push -->|Notification| Browser
```

For detailed sequence diagrams, daemon architecture, and design decisions, see [docs/architecture.md](docs/architecture.md).

---

## Contributors

<a href="https://github.com/chadbyte/clay/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=chadbyte/clay" />
</a>

## Contributing

Bug fixes and typo corrections are welcome. For feature suggestions, please open an issue first:
[https://github.com/chadbyte/clay/issues](https://github.com/chadbyte/clay/issues)

If you're using Clay, let us know how in Discussions:
[https://github.com/chadbyte/clay/discussions](https://github.com/chadbyte/clay/discussions)

## Disclaimer

This is an independent project and is not affiliated with Anthropic. Claude is a trademark of Anthropic.

Clay is provided "as is" without warranty of any kind. Users are responsible for complying with the terms of service of underlying AI providers (e.g., Anthropic, OpenAI) and all applicable terms of any third-party services. Features such as multi-user mode are experimental and may involve sharing access to API-based services. Before enabling such features, review your provider's usage policies regarding account sharing, acceptable use, and any applicable rate limits or restrictions. The authors assume no liability for misuse or violations arising from the use of this software.

## License

MIT
