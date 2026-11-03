# Workbenches and panes

A workbench opens a tool beside your conversation. An **overlay** floats over the conversation without reducing its layout area; a **docked** pane reserves space alongside it. Use an overlay for a quick lookup and docking when you want to keep a reference visible while working.

## Open and arrange a tool

1. Select the project or Mate workspace.
2. Open a tool from its tool palette.
3. Choose **Dock** to keep it beside the conversation.
4. Drag the pane header to an offered drop region, or resize using a divider.
5. Choose **Float** to return it to an overlay where offered.

Newly opened tools start as overlays. Existing docked panes can remain behind a new overlay. Opening a tool does not create another agent conversation.

The tools you see depend on the workspace and access. Ordinary projects have tools for files, commands, project records, and scheduled work. **Knowledge** and **Debates** are Mate-workspace tools; **Me** is in Clay's workspace. **Linear** depends on its connection, and **Sketch** displays a wireframe supplied through a conversation.

[![File diff overlay covering the right side of the conversation.](/images/manual/file-overlay.webp)](/images/manual/file-overlay.webp)

*Overlay: the file pane sits over the conversation. The transcript continues beneath it.*

[![The same file diff docked beside a narrower conversation.](/images/manual/file-docked.webp)](/images/manual/file-docked.webp)

*Docked: the file pane reserves its own space, and the conversation reflows beside it. These are two observed layouts of the same demo file.*

## Expand or close

**Expand** gives a pane more workspace; restore it to return to the arrangement. Expanding Knowledge is separate from entering its document editor.

**Close** hides or removes the pane presentation. To stop an agent, use its Stop control. Ending Browser, closing a terminal tab, and deleting a session are separate actions with their own effects.

Pane headers share a translucent, softly blurred surface that follows the workspace theme. Docked and expanded headers let the desktop workspace background show through. The top menu bar uses a denser version of the same glass surface. In **Settings → Personal → Appearance → Workspace background**, choose a circular color swatch (**Clay Gray** by default), use **+** beside the strip to add your own light and dark pair, or select **Clay Embossed** under **Pictures** for a fixed-size repeating periwinkle pattern that stays the same in both appearances. **Classic Mac Dither** offers a fixed-scale black-and-white checkerboard with two-pixel squares. **Clay Memphis** fills the window with centered abstract artwork, with the same image in both appearances. **Clay Clouds** offers natural sky artwork with a subtle Clay-shaped cloud and uses the same centered cover treatment. **Clay Mates** shows pixel Mate heads and the Clay symbol above a checkerboard, also using centered cover. **Clay Meadow** adds a green hill with a winding path beneath a blue sky, using centered cover. **Clay Silicon** uses centered cover for a blue-black hardware collage with a processor, network cables, and a reflective silicon wafer. **Clay Aqua** adds flowing translucent blue curves with a nested mint fold, also using centered cover. **Clay Light** shows blue beams through the Clay silhouette; **Clay Galaxy** shows a rounded C-shaped galaxy with a nested teal curl. Both use centered cover. **Clay Cove** shows a wide cave opening, distant low rock arch, and grassy headland, also using centered cover. Historical color swatches keep the same color across appearances. Clay Gray and custom color pairs adapt to your light or dark appearance while keeping the content palette separate. Worker chip rows remain opaque. A floating header blurs the area underneath it, which may be a conversation or another pane. Tool content stays sharp, and Terminal content keeps its dark palette. Headers use a solid background when reduced transparency is requested or backdrop blur is unavailable.

## Keep a file beside the task

Open a file and choose **Pin this file** to keep that path visible while selecting other files. **Follow file selection** returns the pane to following your selection. For example, pin a specification while reviewing implementation files in another pane. Pinning does not prevent edits to the file.

## Return to a saved arrangement

Project [Views](/docs/split-views) retain supported pane arrangements. They do not save all unsaved tool content or keep external processes running. A reopened Sketch viewer, for example, needs its diagram loaded before you can save or download it.

If a pane is empty, check its selected file, tab, or connection. For tool-specific steps, continue to [Files](/docs/files), [Terminal](/docs/terminal), [Browser](/docs/browser), or [Sketch](/docs/sketch).
