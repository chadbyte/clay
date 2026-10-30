var { createTerminal } = require("./terminal");
var crypto = require("crypto");

var MAX_TERMINALS = 10;
var SCROLLBACK_MAX = 50 * 1024; // 50 KB per terminal

// Idle reclaim: background `claude` TUI PTYs that nobody is viewing and that
// have produced no output / received no input for this long are killed to
// free system resources. Safe because TUI sessions resume on demand from
// their on-disk transcript (lazy resume), so the conversation isn't lost.
var TUI_IDLE_REAP_MS = 3 * 60 * 1000;   // 3 minutes
var TUI_REAP_INTERVAL_MS = 60 * 1000;   // sweep cadence

/**
 * Create a terminal manager for a project.
 * Manages persistent PTY sessions with scrollback buffering.
 * opts: { cwd, send, sendTo }
 */
function createTerminalManager(opts) {
  var cwd = opts.cwd;
  var send = opts.send;
  var sendTo = opts.sendTo;

  var nextId = 1;
  var terminals = new Map(); // id -> terminal session

  /**
   * Create a PTY-backed terminal.
   *
   * opts (optional):
   *   - initialInput: string injected into the PTY right after spawn
   *     (used by TUI sessions to launch `claude --session-id <uuid>`).
   *   - title: initial title override.
   *   - kind: free-form tag (e.g. "tui-session") for callers to discriminate
   *     their terminals from generic shell tabs. Not used by the manager.
   *   - onExit(session): callback fired after the PTY exits and subscribers
   *     are notified. Used by TUI sessions to delete their session record so
   *     stale entries don't accumulate.
   *   - onData(chunk): callback fired on every PTY output chunk. Used by TUI
   *     sessions to bridge PTY activity into the SDK-style isProcessing
   *     pipeline (drives the cross-project icon-strip blink).
   */
  function create(cols, rows, osUserInfo, ownerWs, opts) {
    if (terminals.size >= MAX_TERMINALS) return null;

    var pty = createTerminal(cwd, cols, rows, osUserInfo, opts);
    if (!pty) return null;

    var id = nextId++;
    var session = {
      id: id,
      identity: crypto.randomUUID(),
      pty: pty,
      scrollback: [],
      scrollbackSize: 0,
      totalBytesWritten: 0,
      cols: cols || 80,
      rows: rows || 24,
      title: (opts && opts.title) || ("Terminal " + id),
      kind: (opts && opts.kind) || "shell",
      lastActivityAt: Date.now(),
      exited: false,
      exitCode: null,
      exitWaiters: [],
      subscribers: new Set(),
      ownerWs: ownerWs || null,
      ownerId: ownerWs && ownerWs._clayUser ? ownerWs._clayUser.id : opts && opts.ownerId || null,
      osIdentity: osUserInfo ? JSON.stringify([osUserInfo.user, osUserInfo.uid, osUserInfo.gid, osUserInfo.home]) : null,
      onExitHook: (opts && typeof opts.onExit === "function") ? opts.onExit : null,
      onDataHook: (opts && typeof opts.onData === "function") ? opts.onData : null,
    };

    pty.onData(function (data) {
      // Buffer scrollback with timestamps
      var ts = Date.now();
      session.lastActivityAt = ts; // output counts as activity (don't reap a working claude)
      session.scrollback.push({ ts: ts, data: data });
      session.scrollbackSize += data.length;
      session.totalBytesWritten += data.length;
      while (session.scrollbackSize > SCROLLBACK_MAX && session.scrollback.length > 1) {
        session.scrollbackSize -= session.scrollback[0].data.length;
        session.scrollback.shift();
      }

      // Broadcast to subscribers
      var msg = JSON.stringify(Object.assign({ type: "term_output", id: id, data: data }, controlProjection(id)));
      for (var ws of session.subscribers) {
        if (ws.readyState === 1) ws.send(msg);
      }

      // Caller-supplied data hook: TUI session manager uses this to
      // debounce-toggle session.isProcessing so the cross-project IO dot
      // blinks during claude activity.
      if (session.onDataHook) {
        try { session.onDataHook(data); } catch (e) {}
      }
    });

    pty.onExit(function (e) {
      session.exited = true;
      session.exitCode = e && e.exitCode != null ? e.exitCode : null;
      session.pty = null;
      session.exitWaiters.splice(0).forEach(function (resolve) { resolve(true); });

      var msg = JSON.stringify({ type: "term_exited", id: id });
      for (var ws of session.subscribers) {
        if (ws.readyState === 1) ws.send(msg);
      }

      // Broadcast updated list
      send({ type: "term_list", terminals: list(true) });

      // Caller-supplied hook: e.g. TUI session manager uses this to delete
      // its session record once `claude` exits, so stale entries don't pile
      // up in the sidebar.
      if (session.onExitHook) {
        try { session.onExitHook(session); } catch (err) {}
      }
    });

    terminals.set(id, session);
    return session;
  }

  function attach(id, ws) {
    var session = terminals.get(id);
    if (!session) return false;

    // Skip scrollback replay if already subscribed (e.g. create then activate)
    var alreadySubscribed = session.subscribers.has(ws);
    session.subscribers.add(ws);

    // Replay scrollback only for newly attached clients
    if (!alreadySubscribed && session.scrollback.length > 0) {
      var replay = session.scrollback.map(function(c) { return c.data; }).join("");
      sendTo(ws, { type: "term_output", id: id, data: replay });
    }

    // This snapshot may arrive after the attaching client has fitted a new viewport.
    if (!alreadySubscribed && session.cols && session.rows) {
      sendTo(ws, { type: "term_resized", id: id, cols: session.cols, rows: session.rows, initial: true });
    }

    // If already exited, notify
    if (session.exited) {
      sendTo(ws, { type: "term_exited", id: id });
    }

    return true;
  }

  function detach(id, ws) {
    var session = terminals.get(id);
    if (!session) return;
    session.subscribers.delete(ws);
  }

  function detachAll(ws) {
    for (var session of terminals.values()) {
      session.subscribers.delete(ws);
    }
  }

  function write(id, data) {
    var session = terminals.get(id);
    if (session && session.pty && session.kind !== "provider-install" && session.kind !== "github-login") {
      session.lastActivityAt = Date.now(); // user input counts as activity
      session.pty.write(data);
    }
  }

  function resize(id, cols, rows, sourceWs) {
    var session = terminals.get(id);
    if (!session || !session.pty) return;
    // Only the terminal owner can resize the PTY.
    // Observers resizing would cause SIGWINCH and flood the owner with escape sequences.
    if (session.ownerWs && sourceWs && sourceWs !== session.ownerWs) return;
    if (cols > 0 && rows > 0) {
      try {
        session.pty.resize(cols, rows);
        session.cols = cols;
        session.rows = rows;
        // Notify other subscribers about the resize so their xterm stays in sync
        var msg = JSON.stringify(Object.assign({ type: "term_resized", id: id, cols: cols, rows: rows }, controlProjection(id)));
        for (var ws of session.subscribers) {
          if (ws.readyState === 1 && ws !== sourceWs) ws.send(msg);
        }
        if (sourceWs && sourceWs.readyState === 1) sourceWs.send(JSON.stringify(Object.assign({ type: "term_control_projection", id: id }, controlProjection(id))));
      } catch (e) {}
    }
  }

  function close(id) {
    var session = terminals.get(id);
    if (!session) return;

    if (session.pty) {
      try { session.pty.kill(); } catch (e) {}
      session.pty = null;
    }

    // Notify subscribers
    var msg = JSON.stringify({ type: "term_closed", id: id });
    for (var ws of session.subscribers) {
      if (ws.readyState === 1) ws.send(msg);
    }

    terminals.delete(id);

    // Reset counter when all terminals are closed
    if (terminals.size === 0) nextId = 1;
  }

  // Keep the terminal registered until its actual exit acknowledges shutdown.
  async function closeAndWait(id, control) {
    var session = terminals.get(id);
    if (!session) throw new Error("Terminal closure cannot be confirmed: runtime is missing.");
    if (control) { control.revalidate(); if (session.identity !== control.identity) throw new Error('The exact terminal identity changed.'); }
    if (!session.exited) {
      if (!session.pty) throw new Error("Terminal closure is unconfirmed.");
      var timer, waiter;
      var exited = new Promise(function (resolve, reject) {
        waiter = resolve; session.exitWaiters.push(waiter);
        timer = setTimeout(function () { reject(new Error("Terminal exit acknowledgement timed out.")); }, 5000);
      });
      try { session.pty.kill(); await exited; }
      catch (error) { exited.catch(function () {}); throw error; }
      finally { clearTimeout(timer); var index = session.exitWaiters.indexOf(waiter); if (index >= 0) session.exitWaiters.splice(index, 1); }
    }
    if (terminals.get(id) !== session) {
      var replaced = new Error('Terminal was replaced during shutdown.');
      if (control) replaced.productControlResult = { runtimeEffect: session.exited ? 'exited' : 'closure_unconfirmed', replacementRetained: true, retrySafe: false };
      throw replaced;
    }
    if (control) {
      try { control.revalidate(); }
      catch (error) { error.productControlResult = { runtimeEffect: 'exited', retained: true, retrySafe: false }; throw error; }
    }
    close(id); return true;
  }

  function rename(id, title) {
    var session = terminals.get(id);
    if (!session) return;
    session.title = String(title).substring(0, 50);
  }

  function inspect(id) {
      var terminal = terminals.get(id);
      return terminal ? { id: id, identity: terminal.identity, ownerId: terminal.ownerId, osIdentity: terminal.osIdentity, title: terminal.title, kind: terminal.kind, exited: terminal.exited, cols: terminal.cols, rows: terminal.rows, totalBytesWritten: terminal.totalBytesWritten } : null;
  }

  function controlProjection(id) { var item = inspect(id); return item ? { controlIdentity: item.identity, controlRevision: require('./clay-control-target-projection').digest(item) } : {}; }

  function list(control) {
    var result = [];
    for (var session of terminals.values()) {
      var entry = {
        id: session.id,
        title: session.title,
        kind: session.kind,
        exited: session.exited,
      };
      if (control) { entry.controlIdentity = session.identity; entry.controlRevision = require('./clay-control-target-projection').digest(inspect(session.id)); }
      result.push(entry);
    }
    return result;
  }

  function getScrollback(id) {
    var session = terminals.get(id);
    if (!session) return null;
    var content = session.scrollback.map(function(c) { return c.data; }).join("");
    return {
      content: content,
      chunks: session.scrollback,
      totalBytesWritten: session.totalBytesWritten,
      bufferStart: session.totalBytesWritten - content.length
    };
  }

  // Periodic sweep: reclaim idle background TUI PTYs. A terminal is reaped
  // only when it's a `tui-session`, has no live subscribers (nobody's viewing
  // it), and has seen no input/output for TUI_IDLE_REAP_MS. The session is
  // flagged reclaimed so its onExitHook keeps the Clay session record
  // (lazy-resume re-spawns claude on demand) instead of deleting it.
  function reapIdleTuiTerminals() {
    var now = Date.now();
    var toReap = [];
    for (var session of terminals.values()) {
      if (session.kind !== "tui-session" || session.exited || !session.pty) continue;
      if (session.subscribers.size > 0) continue;
      if (now - (session.lastActivityAt || 0) < TUI_IDLE_REAP_MS) continue;
      toReap.push(session);
    }
    for (var i = 0; i < toReap.length; i++) {
      toReap[i].reclaimed = true;
      close(toReap[i].id); // pty.kill -> onExit -> onExitHook(session)
    }
  }

  // Flag a terminal as reclaimed (PTY closed but the owning Clay session
  // should be kept, not deleted). Used by idle reap and by an explicit
  // user "Close" before close() so the onExitHook can tell the difference
  // from a real /exit.
  function markReclaimed(id) {
    var session = terminals.get(id);
    if (session) session.reclaimed = true;
  }

  var reapTimer = setInterval(reapIdleTuiTerminals, TUI_REAP_INTERVAL_MS);
  if (reapTimer && typeof reapTimer.unref === "function") reapTimer.unref();

  function destroyAll() {
    if (reapTimer) { clearInterval(reapTimer); reapTimer = null; }
    for (var session of terminals.values()) {
      // Shutdown teardown: pty.kill triggers pty.onExit asynchronously, and
      // that handler would normally invoke onExitHook (which for TUI
      // sessions deletes the Clay session record AND unlinks its on-disk
      // jsonl). On a graceful daemon stop that's exactly the wrong move -
      // sessions should survive the restart. Null the hook so onExit
      // becomes a no-op for cleanup-on-shutdown.
      session.onExitHook = null;
      if (session.pty) {
        try { session.pty.kill(); } catch (e) {}
        session.pty = null;
      }
    }
    terminals.clear();
  }

  function has(id) {
    var s = terminals.get(id);
    return !!(s && s.pty);
  }

  return {
    create: create,
    attach: attach,
    detach: detach,
    detachAll: detachAll,
    write: write,
    writeGithub: function (id, data, identity) {
      var item = terminals.get(id);
      if (item && item.kind === 'github-login' && item.identity === identity && item.pty) item.pty.write(data);
    },
    resize: resize,
    close: close,
    closeAndWait: closeAndWait,
    inspect: inspect,
    resizeExact: function (id, cols, rows, identity, revalidate) {
      revalidate();
      var terminal = terminals.get(id);
      if (!terminal || terminal.identity !== identity || !terminal.pty) throw new Error('The exact terminal is unavailable for resizing.');
      terminal.pty.resize(cols, rows);
      revalidate();
      if (terminals.get(id) !== terminal) throw new Error('Terminal was replaced during resize.');
      terminal.cols = cols; terminal.rows = rows;
      var message = JSON.stringify(Object.assign({ type: 'term_resized', id: id, cols: cols, rows: rows }, controlProjection(id)));
      terminal.subscribers.forEach(function (ws) { if (ws.readyState === 1) ws.send(message); });
      return true;
    },
    identity: function (id) { var terminal = terminals.get(id); return terminal ? terminal.identity : null; },
    rename: rename,
    list: list,
    getScrollback: getScrollback,
    destroyAll: destroyAll,
    has: has,
    markReclaimed: markReclaimed,
  };
}

module.exports = { createTerminalManager: createTerminalManager };
