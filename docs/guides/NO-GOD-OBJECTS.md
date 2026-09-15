# No God Objects

> This codebase was refactored from 5 god objects (project.js 7,222 lines, app.js 8,066 lines, sidebar.js 4,583 lines, server.js 3,702 lines, sdk-bridge.js 2,424 lines) into 56 focused modules across 10 phases. Then the client-side `_ctx` context-bag pattern was eliminated and replaced with a zustand-like store + direct imports. This guide exists to prevent regression.

---

## What is a god object

A file that:
- Has 1,000+ lines
- Handles 3+ unrelated concerns
- Contains 50+ functions that share closure scope
- Is the only file you need to edit for any feature change

When you find yourself saying "I'll just add this to project.js / app.js / server.js," stop. That impulse is how god objects are born.

---

## The rules

### 1. 500 line limit per module

If a module grows past 500 lines, split it. Not "soon" or "next PR." Now.

How to split: identify the second concern in the file (there is always one), extract it into `{parent}-{concern}.js`. Wire it back via the same pattern the parent uses.

### 2. One file, one concern

Each module handles one thing:
- `app-cursors.js` handles cursor presence. Not cursors and tooltips and something else.
- `project-loop.js` handles the loop engine. Not loops and scheduling and file watching.

If you can't describe what a file does in one sentence without "and," it needs splitting.

### 3. Dependencies flow one way

```
coordinator (project.js, app.js, server.js, sidebar.js)
    |
    v
module (project-loop.js, app-dm.js, sidebar-sessions.js)
    |
    v
infrastructure (store.js, ws-ref.js, dom-refs.js, utils.js)
```

- Modules never import their coordinator.
- Modules can import peer modules and infrastructure.
- Coordinators wire modules together but contain no business logic.

### 4. No context bags on the client

The `var _ctx = null` / `initXxx(ctx)` pattern is dead. Do not resurrect it.

```js
// WRONG
var _ctx = null;
export function initFoo(ctx) { _ctx = ctx; }
function doThing() { _ctx.ws.send(...); _ctx.store.dmMode; }

// RIGHT
import { getWs } from './ws-ref.js';
import { store } from './store.js';
function doThing() { getWs().send(...); store.get('dmMode'); }
```

See [CLIENT_MODULE_DEPS.md](./CLIENT_MODULE_DEPS.md) for the full pattern.

### 5. State in store, functions in modules

```js
// Data goes in store
store.set({ connected: true, processing: false });

// Functions stay in their owning module
import { setSendBtnMode } from './app-favicon.js';
import { renderProjectList } from './app-projects.js';
```

Never put functions in store. Never scatter state across module-level variables when it could be in store.

### 6. Reactive over imperative (where it fits)

If the same UI update function is called in 3+ places after setting the same state key, use `store.subscribe` instead.

```js
// WRONG: manual call after every store.set
store.set({ processing: true });
updateLoopButton();  // called in 6 places

// RIGHT: subscriber in the module that owns the UI
store.subscribe(function (state, prev) {
  if (state.processing !== prev.processing) updateLoopButton();
});
// Now any store.set({ processing }) triggers it automatically
```

Only do this when:
- The same function is called after the same state change in 2+ places
- The function reads all its data from store (no local parameters needed)
- No complex business logic is interleaved with the UI update

### 7. Server-side: `attachXxx(ctx)` pattern

Server modules receive a context object with only the dependencies they need. They never require their parent.

```js
// lib/project-loop.js
function attachLoop(ctx) {
  var cwd = ctx.cwd;
  var send = ctx.send;
  // module-private state
  var loopState = null;

  function handleLoopStart(ws, msg) { ... }
  return { handleLoopStart: handleLoopStart };
}
module.exports = { attachLoop: attachLoop };
```

This is different from the client-side pattern (direct imports) because server modules share mutable context (cwd, send, clients) that changes per project instance.

---

## Warning signs

| Symptom | Problem | Fix |
|---------|---------|-----|
| File over 500 lines | Growing toward god object | Extract second concern |
| `import` list over 15 items | Module does too much | Split module |
| Same function called after every `store.set` of key X | Scattered imperative sync | Use `store.subscribe` |
| New `var _ctx = null` appearing | Context bag pattern returning | Use store + direct imports |
| "I'll just add this helper to app.js" | Coordinator accumulating logic | Put it in the owning module |
| switch statement over 20 cases | Message router growing | Ensure each case is a one-line delegation |

---

## Reference

- [MODULE_MAP.md](./MODULE_MAP.md) - where to put new code
- [CLIENT_MODULE_DEPS.md](./CLIENT_MODULE_DEPS.md) - client-side dependency rules
- [STATE_CONVENTIONS.md](./STATE_CONVENTIONS.md) - state management rules
