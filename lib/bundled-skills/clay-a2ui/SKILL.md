---
name: clay-a2ui
description: Default to interactive answers when exploring alternatives, changing assumptions, comparing perspectives or adjusting inputs helps the user understand or choose. Compose the UI freely using Clay's local A2UI catalog; ordinary factual answers stay prose.
---

# Interactive exploration in an answer

This is available in project chats and private Mate conversations, including floating Mate chat and the full workspace. Use this when the user benefits from trying different options in the answer itself. Examples include exploring wording and intent, comparing technical approaches, adjusting a budget, or inspecting a plan from different priorities. These examples are not templates or topic restrictions. Choose the layout, controls and dimensions that actually help this answer.

Treat meaningful exploration as a positive trigger, not an optional decoration. Before answering, ask whether changing a choice, priority, assumption, perspective or input would usefully change the displayed result or explanation. When it would, default to a compact interactive view in this answer. Infer the useful dimensions from the task, including implicit tradeoffs; do not rely on keywords or wait for the user to request a UI. Do not stop at offering to make an interactive version. Prefer a small working exploration over a long list of variants.

Use prose when the available catalog or supplied data cannot represent the answer honestly. Never fabricate facts to fill options or add controls that change nothing meaningful. Do not impose a frequency quota. A static table or short explanation is preferable when interaction adds no value. Respect requests for plain text. Give a useful result immediately; never hide the whole answer behind choices. Keep controls compact and use the user's language. Avoid creating an entire application for a small decision.

Emit one complete `clay-a2ui` fenced JSON object in the assistant answer. No tool call, installation or separate file is needed. Put a concise conclusion in surrounding prose too. Clay renders supported assistant response blocks after the answer completes and when history is reopened. Other clients can read the prose and source.

## Contract

The envelope has exactly `title` (up to 120 characters), `summary` (a readable default answer, up to 2,000 characters), and `messages`. Messages contains exactly one official A2UI 1.0 `createSurface` message. Use catalog ID `https://clay.studio/a2ui/exploration/v1`; it is an identifier, never fetched. Supply `surfaceId`, `catalogId`, `dataModel`, `components`. Use a component named `root` as the tree root. IDs use letters, numbers, hyphens or underscores.

The response is limited to 100,000 characters, 100 components, 200 entries per array, 16,000 characters per string and 12 levels of component nesting. Components form a tree: each child ID is used once, all children exist, no unreferenced components. Layout children are fixed arrays of IDs; dynamic templates are not supported. Do not supply themes, HTML, scripts, CSS, images, external URLs, events or arbitrary functions.

Use literals or `{"@path":"/absolute/data/path"}` for dynamic values. Data paths use letters, digits, underscores or hyphens per segment. Initialize every input in `dataModel`; ChoicePicker values are arrays, so use `/selection/0` when reading its single selected item. Function calls use `{"@call":"lookup","args":{...}}`. Nested calls and bound arguments are supported; never use JavaScript expressions or string interpolation.

### Components

- **Text**: `text`, optional `variant` (`body` or `caption`). Plain readable text; do not depend on Markdown rendering.
- **Column**, **Row**: `children` (IDs), optional `align` (`start`, `center`, `end`, `stretch`), `justify` (`start`, `center`, `end`, `spaceBetween`, `spaceAround`, `spaceEvenly`, `stretch`). Rows wrap on narrow screens.
- **List**: fixed `children`, optional `direction` (`vertical`, `horizontal`) and `align`.
- **Card**: one `child` ID. Use sparingly for meaningful grouping.
- **Tabs**: `tabs:[{"title":"Details","child":"details"},...]`. Make each tab useful.
- **Divider**: optional `axis` (`horizontal`, `vertical`).
- **ChoicePicker**: `label`, `options:[{"label":"...","value":"..."}]`, bound `value` array, `variant` (`mutuallyExclusive` or `multipleSelection`), `displayStyle` (`chips` or `checkbox`), optional `filterable`.
- **Slider**: `label`, finite increasing `min` and `max`, bound numerical `value`, optional `steps` (number of divisions, integer at least 1).
- **CheckBox**: `label`, bound boolean `value`.
- **TextField**: `label`, bound string `value`, optional `placeholder`, `variant` (`shortText`, `longText`, `number`, `obscured`). Do not request secrets. Text remains local.

`weight` is optional for direct children of Row or Column. No buttons or network actions are supported in this catalog. Tabs and input controls work locally without buttons.

### Local functions

- `lookup({table, keys, fallback?})`: join scalar keys with `|` and return that own property from the supplied table. Use bound keys for coordinated text, explanations and values. Author every offered combination, or provide a meaningful fallback. Results may be text or numbers.
- `choose({condition, yes, no})`: choose by a boolean.
- `calculate({operation, values})`: `add`, `subtract`, `multiply`, `divide`, `min`, `max` over 1–30 finite numbers. Avoid zero divisors. This evaluates data, not code.
- `join({values, separator?})`: concatenate up to 30 scalar values, optionally separated.
- `number({value, digits?, currency?})`: format a finite number with 0–6 decimal places (default at most 2), optional three-letter currency code. Formatting uses English number conventions.

Function arguments can include nested calls, paths or literals. No other functions are available, including A2UI's remote fallback functions. Unsupported content produces a readable fallback instead of partial silent output.

## Example: explore a decision

```clay-a2ui
{"title":"Choose a rollout approach","summary":"A pilot limits initial exposure and gives useful feedback before a wider rollout.","messages":[{"version":"1.0","createSurface":{"surfaceId":"rollout","catalogId":"https://clay.studio/a2ui/exploration/v1","dataModel":{"choice":["pilot"],"answers":{"pilot":"Start with one team. Review feedback before expanding.","all":"Release to everyone together. Prepare support and rollback before launch."},"tradeoffs":{"pilot":"Lower initial exposure, but a longer rollout.","all":"Faster reach, but more people encounter any early problems."}},"components":[{"id":"root","component":"Column","children":["choice","answer","tabs"]},{"id":"choice","component":"ChoicePicker","label":"Approach","displayStyle":"chips","variant":"mutuallyExclusive","options":[{"label":"Pilot","value":"pilot"},{"label":"Everyone","value":"all"}],"value":{"@path":"/choice"}},{"id":"answer","component":"Text","text":{"@call":"lookup","args":{"table":{"@path":"/answers"},"keys":[{"@path":"/choice/0"}]}}},{"id":"tabs","component":"Tabs","tabs":[{"title":"Tradeoff","child":"tradeoff"},{"title":"Before deciding","child":"check"}]},{"id":"tradeoff","component":"Text","text":{"@call":"lookup","args":{"table":{"@path":"/tradeoffs"},"keys":[{"@path":"/choice/0"}]}}},{"id":"check","component":"Text","text":"Consider reversibility, support capacity and how representative the pilot team is."}]}}]}
```

## Truthful boundaries

All alternatives and calculations use the data you supply. Never imply that a selection generated a fresh answer, fetched live facts, or ran a model. Label fictional examples and assumptions. Do not invent user circumstances to fill variants.

Selections are temporary, are not returned to the agent and reset on reopening. The response source stays in normal conversation history. If the user wants you to act on a choice, they must tell you in conversation; these controls are not consent, permission, or a structured answer to a pending question. Canonical Clay can author these responses like other agents, but cannot inspect or manipulate the viewer's temporary selections through product tools. Unknown functions, components and catalogs are refused. The renderer has no network or host control access.
