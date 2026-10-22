# Split Views

A saved View arranges sessions and tools in one workspace. It changes what you see, not which agent owns a task or which files a session can edit.

## Add a session beside another

1. Open the session to use as the insertion target.
2. Open its split direction control.
3. Choose **Right**, **Left**, **Top**, or **Bottom**.
4. Clay Studio immediately reserves an empty pane in that direction.
5. Search for a recent session or choose a provider to create one.
6. Select the session and wait for placement.

The picker is centered in the reserved space. Escape dismisses it and restores the previous arrangement. It does not create a placeholder session.

The picker excludes ineligible sessions such as existing members and linked Workers. A session in another multi-session View can show **Move from**; selecting it moves that presentation rather than making a second independent conversation.

If creation succeeds but placement fails or the context changes, the real session can remain in **Unfiled**. Inspect the list before retrying creation.

[![Split view menu offering right, left, top and bottom directions.](/images/manual/split-direction.webp)](/images/manual/split-direction.webp)

*First choose a direction from the session's split control.*

[![A reserved empty pane on the right with a centered session picker.](/images/manual/split-picker.webp)](/images/manual/split-picker.webp)

*Then choose a session in the reserved pane. This demo has no other eligible recent session, so the picker offers new-session providers. Escape cancels the reservation.*

## Find and name the View

The combined arrangement appears as a View in the session sidebar. Select it to return to its panes. Open the View row's menu for **Add pane**, **Rename**, **Add to Favorites**, **Move to folder**, or **Separate**. **Add pane** opens that View and reserves an empty pane to the right of its selected session, with the session picker already open. Escape cancels the reservation.

To remove one session from a multi-session View, open that member session's menu in the sidebar and choose **Remove from View**. The remaining panes stay together, and the removed session remains available separately. Its conversation and running work continue.

Separate returns the sessions to individual presentation; their conversations remain distinct throughout.

## Rearrange a View

Drag a pane header to an offered drop region and release only when the target is correct. Resize using dividers. Open **Split view options** in a pane header for arrangement presets. In an existing multi-pane View, choose **Add Right Split**, **Add Left Split**, **Add Top Split**, or **Add Bottom Split** to reserve empty space beside the session selected at the top of the menu. The same centered picker lets you fill the space. **Choose sessions** first asks for the insertion direction.

Views support up to eight visible sessions, including linked Workers. Tool panes use the same workspace arrangement without becoming agent sessions.

When combining sessions, organization follows the drop target's actual folder, including Unfiled. If both already share a folder, that folder remains the natural destination.

## Work with tools

Open Terminal, Browser, Files, or another workbench, then choose **Dock** to place it beside sessions. New tools start as overlays, even if a previous arrangement was docked. Docked panes remain in the background while another tool overlays them.

Use Expand to focus a pane and restore the arrangement afterward. Closing a presentation is different from deleting its underlying session or stopping its execution.

Saved Views remember the pane arrangement, but do not save every tool's unsaved content. If a reopened Sketch viewer is empty, reopen the diagram from its conversation or saved source before using Save or Download.

See [Workbench layout](/docs/workbench-layout), [Navigation](/docs/navigation), and [Working directories](/docs/projects-working-directories). Saved project Views are not available for private Mate conversations.
