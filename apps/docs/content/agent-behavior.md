# Agent behavior

Agent behavior lets you decide how your own Project Driver conversations use Clay's memory, project records, tools, and service links. Use it when you want a Driver to stop doing something on its own, or to do it only when you ask.

Open **Settings → Personal → Agent behavior**. The page is one scrolling list. The links on its left (**Memory & records**, **Context**, **Tools**, **Connections**) jump to a section. There is no Save button: each choice saves when you select it, and the control shows **Saving...** and then **Saved**. If a save fails, the control shows the error and a **Retry** button.

## Choose a mode

Each setting has three choices.

| Mode | What your Driver does |
| --- | --- |
| **Off** | The related tools and instructions are removed from your Driver. |
| **On request** | Clay instructs the Driver to use the capability only when your message asks for it. |
| **Auto** | The Driver uses the capability when it judges it useful. This is how Clay Studio behaves today. |

Under each control the page states what the selected mode does and gives an example request, so you can check the effect before you rely on it. For example, with **Issues** set to **On request**, you might write “Create an issue for the flaky upload test.” and the Driver files it. Without such a request it will not file one on its own.

**On request** is guidance, not a technical check of your wording. Clay tells the Driver when it may use the capability; it does not inspect your message to confirm you asked.

If you have never changed a setting, everything stays on **Auto**, and the linked-note checkbox described below stays on.

## What you can control

**Memory & records**

| Setting | What it covers |
| --- | --- |
| **Use what Clay knows about me** | Whether your private [Me knowledge](/docs/mate-knowledge-memory-me) is added to the conversation and searchable. **Off** and **On request** both stop Clay from adding it to the conversation automatically. A conversation is marked private only when the Driver actually reads your Me knowledge, so **Off** never does that, and **On request** does it only when you ask. |
| **Suggest things to remember about me** | Whether your Driver may report something you said about yourself for Clay's review. This is separate from using Me knowledge. Nothing is saved until Clay's curator accepts it. |
| **Project Logs** | Whether your Driver writes and revises [Project Logs](/docs/project-logs). With **Off**, people can still read entries and comment, and comments stay pending for you instead of starting an automatic review turn. |
| **Learning records** | The learning category of the Logbook. **Off** makes the Logbook itself refuse learning entries, while other Logbook categories keep working. |
| **Issues** | Whether your Driver searches, files, and updates [Issues](/docs/issues). People still use the Issues tool normally. |
| **Sticky Notes** | Whether your Driver reads the [Sticky Notes](/docs/notes) board and writes notes. |
| **Add a linked note when an Issue is confirmed** | A checkbox under Sticky Notes. It takes effect only while **Sticky Notes** is **Auto** and **Issues** is not **Off**. |

**Context**

| Setting | What it covers |
| --- | --- |
| **History from other sessions** | Whether your Driver may list, search, and read other Driver conversations in the same project. |
| **Continuation proposals** | Whether your Driver may propose continuing a long conversation in a fresh one. You still review and approve every proposal. |

**Tools**

| Setting | What it covers |
| --- | --- |
| **Clay Sketch** | Whether your Driver draws [Sketch](/docs/sketch) wireframes. |
| **Markdown viewer** | Whether your Driver opens Markdown documents in the viewer while editing them. Files are still edited normally. |
| **Shared Browser** | Whether your Driver uses the [Browser](/docs/browser). A page that is already open is left alone. |
| **Worker proposals** | Whether your Driver proposes new Split Workers. Each proposal appears on a card; unless full access is on, you choose the runtime and accept it, and in full access Clay may auto-accept the exact validated recommendation. Managing an existing Worker, and Stop, are never affected. See [Worker lifecycle](/docs/worker-lifecycle). |

**Connections**

| Setting | What it covers |
| --- | --- |
| **GitHub session links** | Whether your Driver labels a conversation with the [GitHub](/docs/github) issue or pull request it is working on. Clay never writes to GitHub for this setting, and links that already exist stay visible. |
| **Linear session links** | The same for a [Linear](/docs/linear) issue. Reading and searching Linear issues stay available even when this is **Off**. |

## When a change takes effect

A saved change applies from your next message in each conversation. A turn that is already running finishes with the settings it started with, except that **Off** blocks a tool call immediately, even if that turn still holds the tool. The transcript keeps whatever already happened; changing a setting does not erase it.

Open conversations pick the change up when they rebuild their runtime at your next message. You do not need to start a new conversation.

## Scope and limits

- **Your own Driver sessions only.** The settings apply to the Project Driver conversations you own, in single-user mode and in account mode. They are stored on the server for your account, so they follow you across devices.
- **Mates and Clay are not affected.** Mates and Clay, the lead Mate, keep their normal behavior even if you switch everything off. Clay cannot read or change these settings, because Personal settings are not part of what Clay operates for you.
- **Safety and reviews do not change.** Permission prompts, Worker acceptance cards, Continuation approval, and Stop work as before under every setting.
- **Sketch and Shared Browser Off.** With either set to **Off**, the tools and instructions are removed and the matching bundled skill is left out of that conversation's skills for every provider (Claude gets a filtered copy of Clay's bundled skill set for that query). The one limit: an assistant could still write a sketch as plain chat text, because that is ordinary Markdown Clay cannot block.

For what each permission mode asks you to approve, see [Permissions and approvals](/docs/permissions).
