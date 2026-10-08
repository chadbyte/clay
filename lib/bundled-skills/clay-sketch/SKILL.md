---
name: clay-sketch
description: Draw and revise UI wireframes directly in Clay chat with the built-in clay-sketch renderer. Automatically use for requests to see a wireframe, sketch a screen, visualize a page layout or UI plan, or revise an existing sketch, including entire webpages and the current project. The user does not need to name clay-sketch. Also use for /clay-sketch or $clay-sketch. Do not substitute this for implementing a working website, generating artwork, or drawing architecture and sequence diagrams.
---

# clay-sketch

Use clay-sketch to make UI ideas visible while keeping design changes in the
conversation. It ships with Clay: no installation, browser automation, external
renderer, or generated image is needed. Its markup is a supported subset of
PlantUML Salt with optional Clay screen-layout extensions, not the full PlantUML language.

Treat ordinary requests such as "show me a wireframe of our work", "sketch this
screen", or "what would this page look like?" in a UI planning conversation as
requests for clay-sketch. Do not require the feature name or ask the user to
choose a rendering format. Use the current project and conversation as context.
Default to a rendered sketch; use ASCII wireframes only when explicitly requested.

## Draw in chat

1. Use the user's requirements and existing conversation to choose a sensible
   first layout. Ask a structured question only when a missing decision would
   materially change the design. Avoid setup questions or requiring a file.
2. Show a complete sketch in a fenced `clay-sketch` block. Include `@startsalt`
   and `@endsalt`. Clay renders the block inline and retains its source.
3. For a whole page, use the screen-layout mode below with an explicit canvas
   and region tracks. Default to 1440 × 900 for desktop unless context suggests
   another size. Do not simulate a screen by increasing scale, font sizes or
   padding labels with spaces. Use realistic labels and a clear primary action.
4. Briefly explain the important layout decisions. The controls are drawings,
   not interactive application controls. Keep the sketch focused on structure.

Use one sketch per block. Existing `plantuml`, `puml`, and `salt` fences also
work. Prefer `clay-sketch` for new responses. Don't replace a rendered sketch
with a screenshot or unsolicited ASCII art.

## Revise together

When the user requests changes or wants to work together on a sketch, call
`present_wireframe` (or its available `clay-documents` qualified equivalent)
with the complete revised Salt source, a short title, and a stable design id
such as `account-settings`. Reuse that id for revisions of the same design.
This opens or updates clay-sketch in Sketch viewer, the right-side viewer. It only presents the
sketch; it does not save a file.

Include the same complete revised source in a `clay-sketch` response block so
the revision remains in chat history. Preserve requirements from earlier turns.
Do not send a patch or a fragment as the diagram source.

All editing happens through conversation. The user
can choose **Save to project** to create a `.puml` file, or **Download** to save
the source to their device. Do not create files automatically. If explicitly
asked to save through your file tools, use the requested path and normal file
permissions. Do not silently overwrite existing work.

If the presentation tool is unavailable, provide the inline sketch and explain
that **Open sketch** opens the viewer. Do not claim you opened it.

Use clean lines for new sketches. Do not add handwritten directives or suggest
a handwritten mode. The viewer credits PlantUML Salt and links to its documentation.

## Supported notation

- `{ ... }`: layout container; newlines separate rows and `|` separates columns.
  Nest containers to build a whole page. Put a space or newline after `{`.
- `{+ ... }`: outer border; `{# ... }`: grid; `{! ... }`: column lines;
  `{- ... }`: row lines.
- `{^"Account" ... }`: titled group. Put its rows on following lines.
- `{/ <b>Overview | Settings }`: tabs. Newline-separated tabs form a vertical list.
- `{* File | Edit | Help }`: a menu bar; following rows such as `File | Open | - | Exit` show an open menu.
- `Plain label`, `**Bold label**`, `<b>Bold label`, `<i>Italic label`.
- `[Continue]`: button; `"Email address       "`: text field. Spaces inside
  quotes reserve width; keep labels short enough to remain readable.
- `[] Remember me`, `[X] Enabled`: checkboxes.
- `() Option`, `(X) Selected`: radio controls.
- `^Choose a team^`: closed dropdown; `^Choose^^One^^Two^`: open dropdown.
- `.`: empty cell or vertical spacer; `..`, `--`, `==`, `~~`: separators.
- `*` following a cell spans the preceding cell across that column.
- `{T` with `+ Root`, `++ Child` rows: tree; `T!`, `T#`, `T+`, `T-` add grid lines.
- `{S`, `{SI`, `{S-`: both, vertical-only, horizontal-only scrollbars.
- `//italic//`, `""monospace""`, `--strike--`, `__underline__`, `~~wave~~`;
  `<color:blue>`, `<back:orange>`, `<size:20>` and `<&folder>` icons.
- `* Bullet` and `# Numbered item`: list labels; repeat the marker for nesting.
- `title`, `header`, `footer`, `caption` before the layout; multiline
  `legend` / `end legend`; `scale 2`, `skinparam dpi 200`, background colors.
- Lines beginning with an apostrophe are comments.

Use `.` explicitly for empty cells. Avoid gratuitous spacers or very long fields;
wide diagrams shrink in chat, though the viewer offers Fit, 100% reset and zoom up to 400%.
The renderer limits source to 100 KB, nesting to 24 levels, cells to 2000,
columns to 64, and layout dimensions to 8192 pixels.

Use bundled icons for ordinary wireframes. When an image is needed and its URL
is supplied or authorized for the design, `<img:https://…>` embeds a public PNG.
This requires network access, allows no redirects or private addresses, and is
limited to four images of 1 MiB and 2048 × 2048 pixels each. Do not invent image
URLs. Local files and SVG images are not supported. Salt's inline `.`/`X`
pseudo-sprites also work without networking.

Supported font sizes are 10, 12, 13, 14, 16, 18 and 20, with sans-serif or
monospace text. Avoid arbitrary fonts, includes, macros, external themes,
general PlantUML sprites, links and other UML types.
On a syntax error, simplify the sketch using the notation above; never suggest
installing Java or sending source to a hosted renderer. For architecture,
flowcharts, or sequence diagrams, use the existing Mermaid support instead.

## Compact layout example

```clay-sketch
@startsalt
{+
  { **Workspace** | Project: Website | [Settings] }
  {
    {^"Navigation"
      **Overview**
      Projects
      Team
      [New project]
    } |
    {^"Projects"
      {/ <b>Active | Archived }
      { "Search projects...          " | [Create project] }
      ..
      {# **Project** | **Status** | **Owner**
        Website | In progress | Alex
        Mobile app | Planning | Sam
      }
      ..
      [View all projects]
    }
  }
}
@endsalt
```

## Whole-screen layout (Clay extension)

For full-page UI plans, start with the example below. The apostrophe directives
are Clay extensions: standard PlantUML treats them as comments and renders its
usual compact layout. Plain Salt without these directives retains reference
behavior. Do not claim the extended layout is standard PlantUML Salt.

- `' @clay-canvas 1440 900` sets logical screen dimensions (240–4096 per axis).
- `' @clay-layout root ...` configures the outer container. A path such as
  `root.1.0` selects row 1, column 0, zero-based. Append row/column pairs for
  nested containers. Update paths when moving content.
- `columns=240,*` fixes the sidebar width and gives remaining width to content.
  `rows=64,*` fixes the header and lets the body fill the remaining height.
  Tracks accept pixel integers, `auto` (content size), and `*` (share free space).
  Supply exactly one track per row/column. Without tracks, rows/columns use auto.
- `padding=24 gap=16` sets container insets and spacing, without scaling text.
  Defaults are 16 and 12. Set padding/gap to 0 for the outer screen shell.
- Containers fill allocated regions. Text/buttons retain their natural dimensions;
  inputs expand to their column width. Use a `.` in a flexible row to reserve
  deliberate empty space or push a footer down, not repeated blank rows.
- Rules target regular containers, not trees, tabs, menus or scrollbar containers.
  Those widgets can still appear inside a screen using their natural dimensions.
- Overflow is reported, not silently shrunk. Increase the relevant track/canvas
  or simplify the content. Keep titles inside the layout; do not combine screen
  mode with scale/DPI changes or outside title/header/footer/legend directives.

```clay-sketch
@startsalt
' @clay-canvas 1440 900
' @clay-layout root padding=0 gap=0 columns=240,* rows=64,*
' @clay-layout root.0.0 padding=20 gap=24 columns=*,auto
' @clay-layout root.1.0 padding=24 gap=20 columns=* rows=auto,auto,auto,auto,auto,auto,*
' @clay-layout root.1.1 padding=32 gap=24 columns=* rows=auto,auto,auto,auto,*,auto
' @clay-layout root.1.1.0.0 padding=0 gap=24 columns=*,auto
' @clay-layout root.1.1.2.0 padding=0 gap=16 columns=*,auto
' @clay-layout root.1.1.3.0 padding=16 gap=16 columns=*,140,180,140 rows=40,48,48,48
{+
  { **Clay Settings** | [My account] } | *
  {
    [Back to project]
    Profile
    Appearance
    Models
    **MCP connections**
    Notifications
    .
  } |
  {
    { <size:20>**MCP connections** | [Add connection] }
    Connect tools and services for your conversations.
    { "Search connections..." | ^All statuses^ }
    {-
      **Connection** | **Type** | **Status** | **Action**
      Team knowledge | Remote URL | Connected | [Manage]
      Support tools | Remote URL | Sign-in required | [Sign in]
      My computer | Extension | Offline | [Manage]
    }
    .
    Connections are personal to your account.
  }
}
@endsalt
```
