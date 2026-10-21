var groups = [
  { id: "start", title: "Start here", pages: [
    ["getting-started", "Getting started", "Install Clay Studio, sign in with a provider, and open the workspace."],
    ["provider-auth", "Provider sign-in", "Connect an AI provider and understand provider-specific limits."],
    ["first-project", "Your first project", "Create a project, choose a working directory, and run a first session."]
  ]},
  { id: "workspace", title: "Workspace", pages: [
    ["navigation", "Navigate Clay Studio", "Use the sidebar, search, favorites, folders, and keyboard focus."],
    ["split-views", "Split Views", "Create, move, resize, rename, favorite, and separate panes."],
    ["workbench-layout", "Workbenches and panes", "Use overlays, docking, expand, fullscreen, and appearance controls."],
    ["projects-working-directories", "Projects and working directories", "Understand project roots, working folders, and project-level tools."]
  ]},
  { id: "sessions", title: "Projects and sessions", pages: [
    ["session-lifecycle", "Session lifecycle", "Create, resume, rename, stop, and continue sessions."],
    ["session-history-search", "History and search", "Find sessions, search a conversation, and inspect history."],
    ["session-fork-rewind", "Fork and rewind", "Fork a session or rewind project work with a clear recovery path."],
    ["session-privacy-sharing", "Session privacy and sharing", "Set visibility and understand project and worktree access."],
    ["session-settings", "Session settings and handoffs", "Change model, effort, permissions, and continue with another agent."]
  ]},
  { id: "conversation", title: "Conversation and composer", pages: [
    ["composer-basics", "Composer basics", "Send, stop, edit, and refine a message in the main composer."],
    ["drafts-and-queue", "Drafts and the message queue", "Preserve drafts and manage queued messages without losing intent."],
    ["attachments-context", "Attachments and context", "Attach files, images, pasted content, and contextual sources."],
    ["mentions-voice-slash", "Mentions, voice, and slash commands", "Address Mates and users, dictate, and use available shortcuts."],
    ["responses-plans-todos", "Responses, plans, and Todo", "Read tool results, plans, task progress, and approval requests."],
    ["delayed-messages", "Delayed composer messages", "Schedule a one-off message from a conversation composer."]
  ]},
  { id: "agents", title: "Drivers and Workers", pages: [
    ["models-and-providers", "Models and providers", "Choose a model and account for provider capability differences."],
    ["permissions", "Permissions and approvals", "Choose Ask, Auto, or YOLO behavior with the right guardrails."],
    ["stop-recovery", "Stop and recover work", "Stop active work, inspect partial results, and resume deliberately."],
    ["usage-and-context", "Usage and context", "Read usage, context limits, and provider reporting carefully."],
    ["drivers-workers", "Drivers and Split Workers", "Understand the Driver/Worker relationship and bounded delegation."],
    ["worker-messages-queues", "Worker messages and queues", "Send live messages, queue work, interrupt, and resume."],
    ["worker-lifecycle", "Worker lifecycle", "Review proposals, replace or close Workers, and preserve ownership."],
    ["background-task-conversations", "Background task conversations", "Open, stop, and review provider-supported background tasks."],
    ["provider-capabilities", "Provider capabilities and interfaces", "Compare GUI, TUI, model, and provider capability differences."]
  ]},
  { id: "tools", title: "Tools and workbenches", pages: [
    ["files", "Files", "Open, edit, preview, pin, follow, and review files."],
    ["file-history-git", "File history and Git", "Inspect diffs, history, review changes, and link repository work."],
    ["terminal", "Terminal", "Open terminal tabs, run commands, and keep terminal chrome predictable."],
    ["browser", "Browser", "Use tabs, cookies, incognito, viewport controls, and pause/resume."],
    ["sketch", "Sketch", "Create a wireframe and save or download the rendered sketch."],
    ["knowledge-documents", "Knowledge documents", "Create, search, edit, recover, and inspect document history."],
    ["knowledge-databases", "Knowledge databases", "Use schemas, records, views, imports, and recovery."]
  ]},
  { id: "records", title: "Project records", pages: [
    ["project-logs", "Project Logs", "Read durable continuity records, revisions, and comments."],
    ["issues", "Issues", "Track concrete work through an issue lifecycle and verification."],
    ["notes", "Sticky Notes and record choice", "Keep short attention items and choose the right project record."]
  ]},
  { id: "mates", title: "Clay Studio, Mates, and Me", pages: [
    ["clay-vs-mates", "Clay Studio and Mates", "Learn how Clay Studio, Clay (the lead Mate), and other Mates differ."],
    ["mate-creation-identity", "Create and shape a Mate", "Set identity, avatar, color, model, and interview context."],
    ["mate-settings-conversations", "Mate settings and conversations", "Manage Mate sessions, instructions, and conversation history."],
    ["mate-knowledge-memory-me", "Knowledge, Memory, and Me", "Distinguish Mate Knowledge from owner observations and saved memory."],
    ["debates", "Debates", "Set up a structured debate with several Mates and inspect the result."]
  ]},
  { id: "automation", title: "Automation", pages: [
    ["mate-schedules", "Private Mate messages", "Create recurring private messages through a Mate scheduling interview."],
    ["scheduled-tasks", "Project Scheduled Tasks", "Schedule Driver and Split Worker work with recurrence and run history."],
    ["loops-and-ralph", "Loop and Ralph", "Use the built-in Loop interview and Ralph workflow where available."],
    ["automation-overlap", "Pause, skip, and overlap", "Understand skipped starts, combined runs, and safe resumption."]
  ]},
  { id: "integrations", title: "Integrations", pages: [
    ["mcp-import-skills", "MCP imports and Skills", "Import vendor connections and use the Skills workbench safely."],
    ["github", "GitHub", "Link issues and pull requests, review changes, and publish intentionally."],
    ["linear", "Linear", "Connect Linear for issue context and know what Clay Studio can write."],
    ["email", "Personal email and SMTP", "Connect personal mailboxes and distinguish them from server SMTP."],
    ["mcp-servers", "MCP connections and browser extension", "Connect remote, local, and browser-extension MCP servers."]
  ]},
  { id: "team", title: "Team and administration", pages: [
    ["team-users-roles", "Users and roles", "Manage users, roles, permissions, and ownership."],
    ["project-sharing", "Project sharing", "Set public, private, allowed-user, and inherited access."],
    ["worktree-sharing", "Worktree sharing and handoffs", "Share a worktree and use presence and handoff records responsibly."],
    ["account-devices-security", "Account, devices, and security", "Manage credentials, devices, passkeys, and sign-in policy."],
    ["server-settings", "Server administration", "Configure HTTPS, proxy, SMTP, storage, upgrades, restart, and backup."]
  ]},
  { id: "reference", title: "Reference and troubleshooting", pages: [
    ["troubleshooting", "Troubleshooting", "Resolve common symptoms with evidence-backed checks."],
    ["keyboard-shortcuts", "Keyboard shortcuts", "Use verified keyboard controls without relying on browser defaults."],
    ["cli-flags", "CLI reference", "Use documented Clay Studio server commands and CLI options."],
    ["glossary", "Glossary and capability guide", "Clarify Clay Studio terms and capability-dependent behavior."]
  ]},
  { id: "legacy", title: "Legacy entry points", visible: false, pages: [
    ["sessions", "Sessions (legacy guide)", "Keep the original sessions guide URL available while the catalog grows."],
    ["mates", "Mates (legacy guide)", "Keep the original Mates guide URL available while the catalog grows."],
    ["split-workers", "Split Workers (legacy guide)", "Keep the original Split Workers guide URL available while the catalog grows."]
  ]}
];

var documents = [];
var legacyAliases = { sessions: "session-lifecycle", mates: "clay-vs-mates", "split-workers": "drivers-workers" };
groups.forEach(function (group) {
  group.pages.forEach(function (page) {
    documents.push({ slug: page[0], title: page[1], group: group.title, groupId: group.id, description: page[2], legacy: !group.visible && group.id === "legacy", canonicalSlug: legacyAliases[page[0]] || page[0] });
  });
});

module.exports = { groups: groups, documents: documents, legacyAliases: legacyAliases };
