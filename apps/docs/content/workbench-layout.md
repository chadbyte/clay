# Workbench layout

Clay Studio workbenches bring tools into the conversation workspace. Terminal, Browser, Files, Knowledge, Notes, Logs, Issues, Scheduled, Debates, and MCP / Skills have different content but share pane controls.

## Open and dock

1. Select the intended project or conversation.
2. Open the tool from the tool palette.
3. Work in its initial overlay.
4. Choose **Dock** when you want sessions to reserve space beside it.
5. Use **Float** to return it to an overlay where offered.

Opening a tool is not an instruction to permanently reduce the session area. Even when an older docked preference exists, a newly opened tool starts as an overlay. Existing docked tools can remain behind a new overlay.

Drag supported pane headers and resize dividers to arrange the workspace. Watch the visible drop target before releasing. A drag tint identifies the pane being moved; it does not indicate a change in resource ownership.

## Expand and close

**Expand** gives a pane more workspace. Restore it to return to the layout. Expansion is presentation: expanding Knowledge does not by itself enter its document editor or change content.

**Close** hides or removes the pane presentation. Resource-specific actions such as ending Browser, closing a terminal tab, deleting a session, or removing a Worker have their own effects and confirmations. Use those actions deliberately.

Terminal content keeps its fixed dark palette in overlays, docked panes, and expanded mode. Pane chrome follows the surrounding workspace appearance.

## Follow or pin files

A Files pane can follow current file selection or stay pinned to one path. Use **Pin this file** to retain a reference while opening other files. Switch to **Follow file selection** when you want the pane to track selection again.

This is useful for comparing an implementation with a specification. Confirm the path in each header before editing or interpreting a diff.

## Saved layouts and restoration

[Saved Views](/docs/split-views) retain supported pane arrangements. A restored shell does not guarantee that an external process or unsaved document still exists. Sketch source and browser runtime state have their own lifetimes.

If a pane appears empty, check its selected resource and connection. If controls are stale after changing account/project, reopen the tool in the correct context rather than acting on the old target.

See [Files](/docs/files), [Terminal](/docs/terminal), [Browser](/docs/browser), and [Sketch](/docs/sketch) for tool-specific tasks.
