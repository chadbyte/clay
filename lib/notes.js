var fs = require("fs");
var path = require("path");
var crypto = require("crypto");
var config = require("./config");
var utils = require("./utils");
var lifecycle = require("./notes-lifecycle");

function createNotesManager(opts) {
  var cwd = opts.cwd;

  // Storage path: ~/.clay/notes/{encodedCwd}.json
  var notesDir = path.join(config.CONFIG_DIR, "notes");
  var encodedCwd = utils.resolveEncodedFile(notesDir, cwd, ".json");
  var notesFile = path.join(notesDir, encodedCwd + ".json");

  // In-memory cache
  var notes = loadFromDisk();

  function generateId() {
    return "n_" + Date.now() + "_" + crypto.randomBytes(3).toString("hex");
  }

  // Legacy files are normalized on load, never on read. Nothing is rewritten
  // just because a note was looked at; the projected fields reach disk the next
  // time some other write happens.
  function loadFromDisk() {
    try {
      var data = fs.readFileSync(notesFile, "utf8");
      var parsed = JSON.parse(data);
      return lifecycle.normalizeAll(parsed.notes || []).notes;
    } catch (e) {
      return [];
    }
  }

  function saveToDisk() {
    try {
      fs.mkdirSync(notesDir, { recursive: true });
      var tmpPath = notesFile + ".tmp";
      fs.writeFileSync(tmpPath, JSON.stringify({ notes: notes }, null, 2));
      fs.renameSync(tmpPath, notesFile);
      return true;
    } catch (e) {
      console.error("[notes] Failed to save:", e.message);
      return false;
    }
  }

  function list() {
    return notes;
  }

  function create(data) {
    var now = Date.now();
    var note = {
      id: generateId(),
      text: data.text || "",
      x: typeof data.x === "number" ? data.x : 100,
      y: typeof data.y === "number" ? data.y : 100,
      w: typeof data.w === "number" ? data.w : 240,
      h: typeof data.h === "number" ? data.h : 180,
      color: data.color || "purple",
      opacity: typeof data.opacity === "number" ? data.opacity : 0.64,
      minimized: false,
      // A new note is always an open attention item.
      state: lifecycle.STATE_OPEN,
      closedAt: null,
      closedBy: null,
      zIndex: notes.length + 1,
      createdAt: now,
      updatedAt: now,
    };
    if (data.origin && data.origin.sessionId !== undefined) {
      note.origin = {
        sessionId: data.origin.sessionId,
        vendor: data.origin.vendor || "claude",
      };
    }
    notes.push(note);
    saveToDisk();
    return note;
  }

  function update(id, changes) {
    for (var i = 0; i < notes.length; i++) {
      if (notes[i].id === id) {
        var allowed = ["text", "x", "y", "w", "h", "color", "minimized", "zIndex", "opacity"];
        for (var j = 0; j < allowed.length; j++) {
          var key = allowed[j];
          if (changes[key] !== undefined) {
            notes[i][key] = changes[key];
          }
        }
        // `hidden` is the legacy spelling of the lifecycle. Route it through the
        // transitions so state, hidden, and the close provenance can never
        // disagree, and so an old client cannot half-apply a close.
        if (changes.hidden !== undefined) {
          if (changes.hidden === true) lifecycle.applyClose(notes[i], changes.actor || null, Date.now());
          else lifecycle.applyReopen(notes[i]);
        }
        notes[i].updatedAt = Date.now();
        saveToDisk();
        return notes[i];
      }
    }
    return null;
  }

  // Close a note. This is what completion means: the record stays and only its
  // place on the active canvas changes. Idempotent.
  function close(id, actor) {
    for (var i = 0; i < notes.length; i++) {
      if (notes[i].id !== id) continue;
      if (lifecycle.applyClose(notes[i], actor || null, Date.now())) {
        notes[i].updatedAt = Date.now();
        saveToDisk();
      }
      return notes[i];
    }
    return null;
  }

  // Reopen a closed note. Idempotent.
  function reopen(id) {
    for (var i = 0; i < notes.length; i++) {
      if (notes[i].id !== id) continue;
      if (lifecycle.applyReopen(notes[i])) {
        notes[i].updatedAt = Date.now();
        saveToDisk();
      }
      return notes[i];
    }
    return null;
  }

  function openList() {
    return lifecycle.openNotes(notes);
  }

  function closedList() {
    return lifecycle.closedNotes(notes);
  }

  // Permanent deletion for the human-only closed-note path. Callers must still
  // authorize the actor and recheck the lifecycle before invoking this method.
  // The closed-state guard makes a stale confirmation harmless at storage.
  function removeClosed(id) {
    for (var i = 0; i < notes.length; i++) {
      if (notes[i].id !== id || !lifecycle.isClosed(notes[i])) continue;
      var removed = notes[i];
      notes.splice(i, 1);
      if (saveToDisk()) return removed;
      notes.splice(i, 0, removed);
      return null;
    }
    return null;
  }

  // Retained for maintenance callers that must truly discard a record. It is
  // intentionally not exposed through WebSocket, MCP, or the UI.
  function remove(id) {
    for (var i = 0; i < notes.length; i++) {
      if (notes[i].id === id) {
        notes.splice(i, 1);
        saveToDisk();
        return true;
      }
    }
    return false;
  }

  function bringToFront(id) {
    var maxZ = 0;
    for (var i = 0; i < notes.length; i++) {
      if (notes[i].zIndex > maxZ) maxZ = notes[i].zIndex;
    }
    // Normalize if z-index grows too large
    if (maxZ > 10000) {
      notes.sort(function (a, b) { return a.zIndex - b.zIndex; });
      for (var k = 0; k < notes.length; k++) {
        notes[k].zIndex = k + 1;
      }
      maxZ = notes.length;
    }
    return update(id, { zIndex: maxZ + 1 });
  }

  /**
   * Return formatted text of all active (non-hidden) notes.
   * Used to inject into mate CLAUDE.md so the mate can read them.
   */
  function getActiveNotesText() {
    var active = [];
    for (var i = 0; i < notes.length; i++) {
      if (lifecycle.isOpen(notes[i]) && notes[i].text) active.push(notes[i]);
    }
    if (active.length === 0) return "";
    var lines = [];
    for (var j = 0; j < active.length; j++) {
      var n = active[j];
      var label = n.color ? "[" + n.color + "]" : "";
      lines.push("- " + label + " " + n.text.trim());
    }
    return lines.join("\n");
  }

  return {
    list: list,
    openList: openList,
    closedList: closedList,
    create: create,
    update: update,
    close: close,
    reopen: reopen,
    remove: remove,
    removeClosed: removeClosed,
    bringToFront: bringToFront,
    getActiveNotesText: getActiveNotesText,
  };
}

module.exports = { createNotesManager: createNotesManager };
