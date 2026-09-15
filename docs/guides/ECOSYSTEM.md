# Clay Ecosystem

> All repositories, their roles, and how they connect. Read this before working on cross-repo features.

---

## Project Registry

| Repo | Path | Type | Description |
|------|------|------|-------------|
| **clay** | `.` (this repo) | Core | Main server, daemon, webapp, SDK bridge, YOKE multi-vendor adapter |
| **clay-chrome** | `../../../clay-chrome` | Extension | Chrome/Arc extension for browser automation and MCP relay |
| **clay-mcp-bridge** | `../../../clay-mcp-bridge` | NPM Package | Native Messaging Host, spawns local MCP servers for remote Clay instances |
| **clay-mate-interview** | `../../../clay-mate-interview` | Skill | Deep interview skill for shaping a Mate's identity (generates CLAUDE.md) |
| **clay-debate-setup** | `../../../clay-debate-setup` | Skill | Prepares structured debates between Mates (topic, format, roles, brief) |
| **clay-ralph** | `../../../clay-ralph` | Skill | Designs autonomous coding loop prompts (PROMPT.md + JUDGE.md for Ralph Loop) |

---

## Architecture

```mermaid
graph TD
    subgraph clay ["Clay Server (daemon)"]
        direction TB
        YOKE["YOKE Multi-Vendor<br/>Claude | Codex | Antigravity"]
        MCP_IN["In-app MCP Servers<br/>clay-browser, clay-debate, email"]
        SKILLS["Skills<br/>clay-mate-interview<br/>clay-debate-setup<br/>clay-ralph"]
    end

    subgraph local_mcp ["Local MCP (same machine)"]
        MCP_LOCAL["mcp-local.js<br/>reads $HOME/.clay/mcp.json"]
        MCP_PROC_L["MCP Processes<br/>GitHub, Notion, etc."]
    end

    subgraph remote ["Remote MCP (different machine)"]
        WEBAPP["Browser / PWA"]
        EXT["clay-chrome<br/>Chrome Extension<br/>17 browser_* tools"]
        BRIDGE["clay-mcp-bridge<br/>Native Messaging Host"]
        MCP_PROC_R["MCP Processes<br/>GitHub, Notion, etc."]
    end

    clay -- "WebSocket" --> WEBAPP
    clay -- "stdio JSON-RPC" --> MCP_LOCAL
    MCP_LOCAL -- "stdin/stdout" --> MCP_PROC_L

    WEBAPP -- "postMessage" --> EXT
    EXT -- "Chrome Debugger API" --> BROWSER_TABS["Browser Tabs"]
    EXT -- "Native Messaging" --> BRIDGE
    BRIDGE -- "stdin/stdout" --> MCP_PROC_R
```

---

## Connection Paths

### Local user (same machine as Clay server)

No extension or bridge needed. `mcp-local.js` reads `$HOME/.clay/mcp.json` directly.

```mermaid
sequenceDiagram
    participant S as Clay Server
    participant L as mcp-local.js
    participant P as MCP Process

    S->>L: initialize()
    L->>L: read $HOME/.clay/mcp.json
    L->>P: spawn (stdio)
    L->>P: initialize (JSON-RPC)
    P-->>L: capabilities + tools
    Note over S,P: Tool call
    S->>L: callTool(server, tool, args)
    L->>P: tools/call (stdin)
    P-->>L: result (stdout)
    L-->>S: resolve Promise
```

### Remote user (browser on different machine)

Requires clay-chrome extension + clay-mcp-bridge installed on user's machine.

```mermaid
sequenceDiagram
    participant S as Clay Server
    participant W as Webapp
    participant E as clay-chrome
    participant B as clay-mcp-bridge
    participant P as MCP Process

    Note over S,P: Tool call
    S->>W: mcp_tool_call (WS)
    W->>E: clay_mcp_tool_call (postMessage)
    E->>B: mcp_request (Native Messaging)
    B->>P: tools/call (stdin)
    P-->>B: result (stdout)
    B-->>E: mcp_response
    E-->>W: mcp_tool_result (postMessage)
    W-->>S: mcp_tool_result (WS)
```

### Browser automation (all users)

Extension provides browser_* tools via Chrome Debugger API. No bridge needed.

```mermaid
sequenceDiagram
    participant S as Clay Server
    participant W as Webapp
    participant E as clay-chrome
    participant T as Browser Tab

    Note over S,T: Browser tool call
    S->>W: mcp_tool_call (WS)
    W->>E: clay_ext_command (postMessage)
    E->>T: Chrome Debugger API
    T-->>E: result
    E-->>W: clay_ext_result (postMessage)
    W-->>S: mcp_tool_result (WS)
```

---

## Vendor Support (YOKE)

YOKE (Yoke Overrides Known Engines) is the multi-vendor adapter layer in `lib/yoke/`.

| Vendor | Adapter | Auth Check | MCP Support |
|--------|---------|------------|-------------|
| Claude | `yoke/adapters/claude.js` | `claude auth status` | Full (in-process SDK MCP servers) |
| Codex | `yoke/adapters/codex.js` | `codex login status` | See [CODEX-INTEGRATION.md](CODEX-INTEGRATION.md) |

## Skills

Skills are installable packages that run within Clay sessions. They are NOT separate servers.

| Skill | Trigger | What it does |
|-------|---------|--------------|
| clay-mate-interview | New Mate creation, `/clay-mate-interview` | Conducts identity interview, generates Mate's CLAUDE.md |
| clay-debate-setup | Debate button, `/clay-debate-setup` | Reads team CLAUDE.md + digests, prepares debate brief |
| clay-ralph | `/clay-ralph` | Explores codebase, interviews user, writes PROMPT.md + JUDGE.md |

Skills are discovered from the user's skills directory and merged into slash commands during SDK warmup.

---

## Key Config Files

| File | Purpose |
|------|---------|
| `$HOME/.clay/mcp.json` | MCP server definitions (command, args, env) + include list |
| `$HOME/.clay/daemon.json` | Project list, per-project settings (enabledMcpServers, etc.) |
| `$HOME/.codex/config.toml` | Codex CLI configuration (plugins, project trust levels) |
| `$HOME/.claude/settings.json` | Claude Code settings |

---

## Cross-repo References

When modifying MCP message flow, these files must stay in sync:

| Message | clay (server) | clay-chrome (extension) | clay-mcp-bridge (host) |
|---------|---------------|------------------------|----------------------|
| Tool call | `project-mcp.js` createToolHandler | `background.js` mcpRelayToolCall | `host.js` relayToolCall |
| Tool result | `project-mcp.js` handleToolResult | `background.js` mcpHandleNativeMessage | `host.js` handleMcpResponse |
| Server list | `project-mcp.js` handleServersAvailable | `background.js` broadcastMcpServers | `host.js` getServers |

See `docs/guides/MCP-IMPLEMENTATION.md` for detailed message flow diagrams.
