# State Management Conventions

---

## Current State Diagnosis

Five different state patterns coexist in the codebase today:

| Pattern | Where | Problem |
|---------|-------|---------|
| **Closure variables** | project.js (`clients`, `fileWatcher`, `loopState`, etc.) | 50+ functions share one 6,000-line closure scope. Hard to trace who reads/writes what |
| **Session property bag** | sdk-bridge.js (`session._queryStartTs`, `session.blocks`, `session.pendingPermissions`, 15+ more) | No schema. Anyone can attach any property with an underscore prefix |
| **Module-level globals** | app.js (30+ variables), server.js (`multiUserTokens`, `pinAttempts`) | Client side is worst. 30 globals mutated freely by any event handler |
| **File-based load/save** | mates.js, users.js | Clean. No issues. Keep this pattern |
| **Context object passing** | `createProjectContext` return value | Right idea, but state and functions are mixed together in one bag |

---

## Three Principles

### 1. Extracted modules own their own state

When a module is extracted, any state it needs exclusively moves into its `attach*()` closure. Shared dependencies come in through the `ctx` parameter.

```js
// project-memory.js
function attachMemory(ctx) {
  // Module-private state: declared here, not in project.js
  var digestCache = null;
  var lastSummaryTs = 0;

  // Shared dependencies: received via ctx, never imported from parent
  var cwd = ctx.cwd;
  var slug = ctx.slug;
  var sm = ctx.sm;

  function gateMemory(ws, msg) {
    // uses digestCache (own state) and sm (shared dependency)
  }

  return { gateMemory: gateMemory, /* ... */ };
}
```

**Rule**: If a `var` in project.js is only used by functions moving to the new module, it moves with them. If it is shared, it stays in project.js and gets passed via ctx.

### 2. Session properties are namespaced by module

Instead of flat properties on the session object, group them by the module that owns them.

```js
// Before (flat, no schema)
session._queryStartTs = Date.now();
session.blocks = [];
session._mentionSessions = new Map();
session.pendingPermissions = null;

// After (namespaced by owning module)
session.sdk = { queryStartTs: null, blocks: [], firstTextLogged: false };
session.mentions = { sessions: new Map(), inProgress: false };
session.stream = { preview: "", text: false, inputTokens: 0 };
session.permissions = { pending: null };
```

**Rule**: Apply this incrementally. When extracting a module, namespace the session properties that module uses. Do not refactor session properties belonging to other modules.

### 3. Client-side state lives in store.js

All mutable UI state goes into `store.js`, a zustand-like vanilla store (single object, shallow-merge setState, subscribe). Modules import store directly instead of receiving state through a context bag.

```js
// Before: app.js top-level globals, passed via ctx bag
var cachedDmConversations = null;
var dmMode = false;
// ... initDm(ctx) { _ctx = ctx; } ... _ctx.dmMode ...

// After: store.js owns the state, modules import directly
import { store } from './store.js';
var s = store.getState();
if (s.dmMode) { /* ... */ }
store.setState({ dmMode: true, dmTargetUser: user });
```

Functions stay in their owning modules. Only data lives in store.

**Rule**: New client state always goes in store. Never create `var _ctx = null` / `initXxx(ctx)` patterns. See [CLIENT_MODULE_DEPS.md](./CLIENT_MODULE_DEPS.md) for the full guide.

---

## What NOT to do

- **Do not introduce a heavy state management library or framework.** store.js (zustand-like vanilla store) is sufficient for this codebase size.
- **Do not use `var _ctx = null` / `initXxx(ctx)` context-bag injection on the client.** This pattern is being eliminated. Use store.js + direct imports instead. See [CLIENT_MODULE_DEPS.md](./CLIENT_MODULE_DEPS.md).
- **Do not refactor state across module boundaries in one PR.** Each PR only touches state for the functions it extracts.
- **Do not rename existing session properties until the owning module is extracted.** Renaming before extraction creates unnecessary churn.
- **Do not put functions in store.** Store is for data only. Functions stay in their owning modules and are imported directly.
