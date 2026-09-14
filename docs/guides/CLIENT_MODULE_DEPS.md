# Client-Side State & Dependency Guide

> How client modules (`lib/public/modules/`) manage state, access dependencies, and communicate.

---

## Architecture overview

Clay's client follows a **zustand-like vanilla store** pattern:

```
store.js          -- single source of truth for all mutable UI state
ws-ref.js         -- WebSocket singleton (getWs/setWs)
each module       -- imports store + ws-ref + peer modules directly
app.js            -- bootstraps everything: createStore(), connects WS, wires DOM
```

There is no framework. There is no context bag. Every module is a plain ES module that imports what it needs at the top of the file.

---

## store.js API

```js
import { store } from './store.js';

// Read a single field
var slug = store.get('currentSlug');

// Snapshot for multiple fields
var s = store.snap();
if (s.dmMode && s.dmTargetUser) { ... }

// Write (shallow merge)
store.set({ connected: true });
store.set({ dmMode: false, dmTargetUser: null });

// Subscribe (reactive UI sync)
// Use when a state change should always trigger specific UI updates.
// See app-connection.js for a real example (connected/processing -> status dot, overlay, sendBtn).
store.subscribe(function (state, prev) {
  if (state.connected !== prev.connected) {
    document.getElementById("connect-overlay")
      .classList.toggle("hidden", state.connected);
  }
});
```

Key points:
- `store.get('key')` for single field reads, `store.snap()` when you need multiple fields at once.
- `store.set()` does a shallow merge (like zustand), not a full replacement.
- `subscribe` fires on every `set` call. Compare prev vs current to filter.
- Only **data** lives in store. Functions stay in their owning modules.

---

## Dependency resolution cheat sheet

| I need... | I get it from... | Example |
|-----------|-----------------|---------|
| Mutable UI state (dmMode, connected, currentSlug, ...) | `store.js` | `store.get('dmMode')` |
| Update UI state | `store.js` | `store.set({ processing: true })` |
| WebSocket | `ws-ref.js` | `import { getWs } from './ws-ref.js'` |
| Send a WS message | `ws-ref.js` | `getWs().send(JSON.stringify({ type: 'foo' }))` |
| Function from another module | That module | `import { getCachedProjects } from './app-projects.js'` |
| DOM element | Query locally or import from creator | `document.getElementById('messages')` |
| basePath, wsPath | `store.js` | `store.get('basePath')` |
| React to state changes | `store.subscribe` | See subscribe example above |

---

## Writing a new module (complete example)

```js
// app-example.js
import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { escapeHtml } from './render-utils.js';

var exampleEl = null;

export function handleExampleMessage(msg) {
  if (!exampleEl) exampleEl = document.getElementById('example-panel');
  if (store.get('dmMode')) return;  // skip in DM

  exampleEl.innerHTML = escapeHtml(msg.text);
  getWs().send(JSON.stringify({ type: 'example-ack', id: msg.id }));
  store.set({ lastExampleId: msg.id });
}
```

Notice:
- No `var _ctx = null`. No `export function initExample(ctx)`.
- State read/write through store.
- WS through ws-ref.
- Peer functions through direct import.
- DOM queried lazily on first use.

---

## Module state and dependencies

The legacy `var _ctx = null` / `initXxx(ctx)` pattern has been fully eliminated.

When adding new code to these modules:
- **Never add new `_ctx.xxx` references.** Use `store.getState()`, `store.setState()`, `getWs()`, or direct imports.
- Existing `_ctx` code is fine until the module is fully migrated.
- If you need a value that does not exist in store yet, add it to the `createStore()` call in app.js.

---

## What NOT to do

| Bad | Why | Good |
|-----|-----|------|
| `var _ctx = null; initFoo(ctx) { _ctx = ctx; }` | Hidden coupling, untraceable data flow | Direct imports from store/ws-ref/peer modules |
| `_ctx.ws.send(...)` | WS buried inside context bag | `getWs().send(...)` |
| `_ctx.cachedProjects` | Reaching into another module's data via bag | `import { getCachedProjects } from './app-projects.js'` |
| Putting functions in store | Store is for data only | Export function from owning module |
| `localStorage.setItem('setting', ...)` | Settings must persist across devices | Send via WS, store server-side |
| `store.getState().xxx` | Verbose, use shorthand | `store.get('xxx')` or `store.snap()` for multi-field |
| `store.setState({...})` | Verbose, use shorthand | `store.set({...})` |
