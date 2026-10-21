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

## Rearrange a View

Drag a pane header to an offered drop region and release only when the target is correct. Resize using dividers. Existing multi-pane layouts also offer **Arrange** presets and **Choose sessions**.

Views support up to eight visible session resources, with linked Workers included in capacity checks. Tool panes use the same workspace arrangement without becoming agent sessions.

When combining sessions, organization follows the drop target's actual folder, including Unfiled. If both already share a folder, that folder remains the natural destination.

## Work with tools

Open Terminal, Browser, Files, or another workbench, then choose **Dock** to place it beside sessions. New tools start as overlays, even if a previous arrangement was docked. Docked panes remain in the background while another tool overlays them.

Use Expand to focus a pane and restore the arrangement afterward. Closing a presentation is different from deleting its underlying session or stopping its execution.

Saved Views preserve supported layout bindings, not arbitrary unsaved tool content. A reopened Sketch shell, for example, needs actual sketch source before Save or Download becomes available.

See [Workbench layout](/docs/workbench-layout), [Navigation](/docs/navigation), and [Working directories](/docs/projects-working-directories). Private Mate conversations retain their own presentation boundaries and do not expose ordinary project saved-View authoring.
