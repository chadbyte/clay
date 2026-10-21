# MCP imports and skills

MCP configuration describes tool connections. Skills describe specialized instructions and supporting resources. Importing one is not the same as installing the other.

## Import vendor MCP configuration

1. Open **MCP / Skills → MCP Servers**.
2. Choose **Add → Import vendor config**.
3. Select an available vendor source.
4. Inspect the discovered candidates and their provenance.
5. Choose the exact candidate to review.
6. Approve the import only after checking its command/URL and scope.

Discovery is read-only. It does not execute a candidate command, sign in, or read vendor OAuth stores. Approval saves a disabled copy; it does not silently activate imported tools.

After import, inspect the connection in MCP management, enter any needed credentials there, and deliberately enable/test it. Credentials from a vendor login are not automatically transferable to the imported connection.

If discovery finds several similar entries, compare their source and target. Do not choose one solely because the display name is familiar.

## Find and use skills

Open the Skills area of **MCP / Skills** to browse available skills and inspect their descriptions and instructions. Use the offered install or management action for an optional skill, then verify that it appears in the intended scope.

Invoke a skill by name in the conversation when you want that workflow. A slash entry may be offered where supported by the runtime. Installing a skill does not itself execute its instructions against a project.

Read what a skill can do before granting broad access. Skill text is guidance, not permission to send messages, publish work, or bypass a required product review.

## Clay Studio-specific skills

Clay Studio-specific skills use the `clay-*` namespace. Built-in Clay Studio skills are bundled with the application; optional ones belong under the owner's or project's `.clay/skills/` directory.

Keep those separate from generic vendor discovery folders. This avoids making Clay Studio-specific bridges appear as globally available tools to unrelated sessions.

## Troubleshoot

If an imported connection stays idle, inspect whether it is enabled and whether it connects on use. If a skill is missing, check its installation scope and the active runtime's catalog. If its instructions reference an unavailable dependency, resolve that specific dependency rather than claiming the skill ran.

See [MCP servers](/docs/mcp-servers), [Provider capabilities](/docs/provider-capabilities), and [Permissions](/docs/permissions).
