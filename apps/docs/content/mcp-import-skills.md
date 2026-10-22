# MCP imports and skills

An **MCP connection** gives the agent tools from a service or local program. A **skill** supplies instructions for a repeatable workflow. For example, a connection might let an agent retrieve live issue data, while a skill explains how to structure a review. You can use both in the same task.

If you are adding a service for the first time, start with [MCP connections](/docs/mcp-servers). Use import when you already have a connection configured for another coding agent.

## Import an existing connection

1. Open **MCP / Skills → MCP Servers**.
2. Choose **Add → Import vendor config**.
3. Select an available vendor source.
4. Check the discovered connection's source, command or URL, and scope.
5. Select the connection and approve its import review.

Discovery only reads configuration. Import saves a **disabled copy**; it does not run the command or sign you in. Open the imported connection, enter any required credentials in its settings, then enable and test it. Existing vendor login credentials are not automatically transferred.

If several entries look similar, use their source and destination to choose the right one.

## Find and use a skill

Open the **Skills** area of MCP / Skills and select a skill to read its description and instructions. For an installable skill, choose **Add to this project** or **Add to all projects** according to where you want it available. The detail view shows its installed scope after installation succeeds. Built-in skills are already available and have no install step.

Ask for the skill by name in a conversation: “Use the review skill to assess this proposal.” Some providers also offer it in the slash-command menu. Installation makes the workflow available; it does not run it immediately.

Read the instructions before using a skill for consequential work. Your request and the relevant permission controls still govern sending messages, publishing changes, and other actions.

## Installing Clay Studio-specific skills manually

Skills reserved for Clay Studio use the `clay-*` prefix. Built-ins ship with the application. Optional Clay Studio-specific skills belong in the owner's or project's `.clay/skills/` directory, separate from generic vendor skill folders.

If a skill is missing, check its installed scope and current provider. If a connection remains idle, its status may say it connects when used; [connection states](/docs/mcp-servers) explains how to distinguish that from a failure.
