# clay-sketch: wireframes in chat and Sketch viewer

Use the built-in `clay-sketch` skill for UI plans and sketch revisions. It is
packaged with Clay and appears in the shared skills catalog.

The native renderer follows the original Salt geometry and uses bundled reference
font metrics. The [reference parity check](CLAY_SKETCH_PARITY.md) documents
pixel comparisons, regression coverage, and the remaining scope limits.

For a UI plan, the agent can respond with a fenced `clay-sketch`, `plantuml`, `puml`, or `salt`
block. Clay renders the diagram inline, with **Open sketch** and a
read-only source disclosure. Prefer complete `@startsalt` / `@endsalt` blocks
for Salt wireframes, including entire pages.

When discussing revisions, the agent calls `present_wireframe` with complete
source, a stable design id, and a short title. This opens or updates the temporary
right workbench. The agent also includes the revised diagram in its response,
so each revision remains in chat history. Replaying history renders inline
cards without reopening the workbench.

All diagram editing happens through conversation. The viewer has no source
editor. It follows workbench panel switching, widen, fullscreen, close, and
mobile full-screen conventions. Previews start at natural scale or shrink to fit the whole design. They never
magnify automatically. Use **− / +** to zoom, click the percentage to reset to
**100%**, or choose **Fit**. File previews have the same controls. Changing conversation, project, or account
closes the temporary viewer.

**Save to project** asks for a project-relative `.puml` path in an existing
folder. It checks file permissions and creates a new file exclusively; if the
name already exists, choose another name. **Download** saves the current
PlantUML source to your device. Neither viewing nor agent revisions create
files automatically. A saved file can be reopened from Files.

## File previews

Open a `.puml`, `.plantuml`, `.pu`, `.uml`, or `.salt` file from Files to display
its diagram in the right workbench. The toolbar switches between the diagram
and source. Copy and Download keep the original source file. Presentation mode
expands the diagram, and watched file changes update the preview automatically.

Use one diagram per file. Salt wireframes normally use `@startsalt` and
`@endsalt`; `.salt` files may contain just the Salt body. See
[the full-page Clay example](../examples/clay-workbench.puml).

## Built in: no additional installation

Clay includes a small JavaScript renderer for a documented subset of
[PlantUML Salt](https://plantuml.com/salt). No Java, PlantUML executable, JAR,
Graphviz installation, additional package, or external rendering service is
needed. Rendering uses the existing Node runtime. Sketches without remote images work offline; explicit image URLs are fetched with bounded public-HTTPS requests.

Supported syntax:

- Nested row/column layouts and all Salt grid borders; quoted or unquoted group titles.
- Buttons, fields, radio buttons, checkboxes, tabs, menu bars and open menus/dropdowns.
- Spanning cells (`*`), trees/tree tables (`{T`, `{T!`, `{T#`, `{T+`, `{T-`),
  and scrollbars (`{S`, `{SI`, `{S-`).
- Creole emphasis, monospace, strike/underline/wave, bullets and numbered lists;
  inline colors, backgrounds, Unicode escapes, and sizes 10, 12, 13, 14, 16, 18, 20.
- Bundled Open Iconic icons (`<&name>`) and Salt's inline `.`/`X` pseudo-sprites.
- PNG images using `<img:https://…>`; no arbitrary file access.
- Title, header, footer, caption and multiline legend annotations.
- Background color, scale/DPI and the official handwritten example. As in the
  reference, Salt ignores the demonstrated font/line skin parameters and styles.
- Empty cells, separators and apostrophe comments.

All 35 standalone Salt examples from the official page pass the pinned geometry
and pixel comparison. This is still a bounded Salt implementation, not the full
PlantUML language. The page's five activity-diagram/icon-catalog examples remain
outside scope. Includes, macros, external themes, general PlantUML sprites,
links, arbitrary fonts/sizes, complex-script shaping and other UML types are
unsupported. Handwritten comparisons cover the official example's lines and
rounded rectangles, not every possible shape combination. Unsupported syntax
reports an error instead of requiring another installation.

## Boundaries

- Diagram source stays on the Clay host and in the requesting browser.
- The renderer only parses text and generates SVG; it executes no commands,
  reads no user-specified files, and loads bundled font metrics and icons.
- Explicit PNG images require HTTPS on port 443 without credentials. DNS results
  must be public IPv4 addresses and are pinned for the connection. Private/reserved
  addresses and redirects are rejected. Fetching sends no cookies or diagram source.
  Images are embedded in the SVG, so the browser makes no external image request.
  Limits: four distinct images, 1 MiB each, 2048 × 2048 pixels, ten seconds total,
  and 6 MiB of embedded image data. File URLs, SVG images and other formats are rejected.
- Existing project/file permissions and mapped OS identities govern file reads
  and project saves. Save never overwrites an existing file.
- Source is limited to 100 KB, nesting to 24 levels, cells to 2000, columns to 64,
  and layout dimensions to 8192 pixels. SVG output is limited to 8 MiB.
- The browser displays escaped SVG as an inert image. Controls are drawings;
  clicking individual components to provide feedback is outside this version.

## Verification

```sh
node --test test/plantuml-renderer.test.js test/project-plantuml.test.js test/wireframe-http.test.js
node test/fixtures/plantuml-browser-server.js
```

The browser fixture uses production viewer modules and the built-in renderer, with
simulated file responses. Open its printed URL and choose **Run preview checks**.
All renderer tests run without additional dependencies, including a test with
an empty executable search path and no PlantUML environment configuration.

For chat and workbench checks, open `/test/fixtures/wireframe-browser.html`
on the same fixture server and choose **Run conversation checks**. Project
saves in this fixture go to an isolated temporary directory.

## Sketch viewer identity and style

Inline previews and Sketch viewer share the clay-sketch wordmark, warm accent,
dotted drawing surface and a linked **Built with PlantUML Salt** credit. The
right-side viewer retains existing panel navigation, sizing and fullscreen
conventions. Viewers use clean controls with no handwritten option. New sketches
use clean lines; the Salt renderer still accepts existing source directives.

## Whole-screen proportions

Clay extends Salt with comment directives for a logical canvas and region tracks.
See [the 1440 × 900 MCP screen](../examples/clay-mcp-screen.puml) and the bundled
clay-sketch skill for syntax. A 240px sidebar stays 240px while a flexible content
column uses remaining width; text and buttons are not proportionally enlarged.
The viewer then fits that entire designed screen. These directives are not
standard Salt: PlantUML ignores them as comments and renders its compact layout.
Plain Salt retains the existing parity behavior. Canvas dimensions are bounded
to 240–4096px and overflow or invalid region paths produce actionable errors.

Inline previews use one compact header for brand and Open sketch.
PlantUML Salt attribution shares the source disclosure footer.
