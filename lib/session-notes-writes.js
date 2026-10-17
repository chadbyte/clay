// Pure planning for agent sticky-note updates, including native checklists.
// Every checklist-affecting write must name the note's current version and
// exact item keys, so a stale view can never overwrite newer content or marks.

var checklist = require("./notes-checklist");

var MAX_CHECKS = 1000;

function validateArgs(args) {
  if (args.checklist !== undefined && typeof args.checklist !== "boolean") return "checklist must be true or false";
  if (args.version !== undefined && !Number.isFinite(args.version)) return "version must be the number returned by list_notes";
  if (args.checks === undefined) return null;
  if (!Array.isArray(args.checks) || args.checks.length === 0 || args.checks.length > MAX_CHECKS) {
    return "checks must be a non-empty array of at most " + MAX_CHECKS + " { item, checked } entries";
  }
  for (var i = 0; i < args.checks.length; i++) {
    var entry = args.checks[i];
    if (!entry || typeof entry !== "object" || typeof entry.item !== "string" || typeof entry.checked !== "boolean") {
      return "each checks entry needs an item key from list_notes and checked true or false";
    }
  }
  return null;
}

function staleError(note) {
  return "note " + note.id + " has changed or the version is missing; call list_notes, review its current text and items, and retry with that version";
}

// Saved marks whose exact item line no longer exists after a text change.
function droppedChecks(note, nextText) {
  var kept = checklist.normalizeState(note.checklistState, nextText);
  return checklist.describe(note).filter(function (entry) {
    return entry.saved !== null && kept[decodeURIComponent(entry.item)] === undefined;
  }).map(function (entry) {
    return { text: entry.text, checked: entry.saved };
  });
}

function planUpdate(note, args, text, color) {
  var isChecklist = note.checklistMode === true;
  var modeChange = typeof args.checklist === "boolean" && args.checklist !== isChecklist;
  var hasText = typeof args.text === "string";
  var hasChecks = Array.isArray(args.checks);
  var needsVersion = isChecklist || modeChange || hasChecks;
  if ((needsVersion || args.version !== undefined) && args.version !== note.updatedAt) return { error: staleError(note) };
  if (hasText && !text) return { error: "text must not be empty; close the note instead of erasing it" };
  if (hasText && hasChecks) return { error: "change text and checks in separate calls so item keys refer to one exact version" };

  var changes = {};
  var dropped = [];
  if (hasText && text !== note.text) {
    changes.text = text;
    dropped = droppedChecks(note, text);
    if (isChecklist && !modeChange) {
      // Storage repeats the same exact-source and version guard atomically.
      changes.checklistEdit = true;
      changes.checklistSource = note.text;
      changes.checklistVersion = note.updatedAt;
    }
  }
  if (color && color !== note.color) changes.color = color;
  if (modeChange) changes.checklistMode = args.checklist;

  if (hasChecks) {
    var resultMode = modeChange ? args.checklist : isChecklist;
    if (!resultMode) return { error: "checks apply only to checklist notes; pass checklist: true to switch this note to a checklist without changing its text" };
    var state = checklist.normalizeState(note.checklistState, note.text);
    var requested = Object.create(null);
    for (var i = 0; i < args.checks.length; i++) {
      var found = checklist.findItem(note, args.checks[i].item);
      if (!found) return { error: "checklist item not found in note " + note.id + "; call list_notes and use its current item keys" };
      if (requested[found.key] !== undefined && requested[found.key] !== args.checks[i].checked) {
        return { error: "checks names the same item more than once with different values" };
      }
      requested[found.key] = args.checks[i].checked;
      state[found.key] = args.checks[i].checked;
    }
    changes.checklistState = state;
  }

  if (!hasText && !hasChecks && !color && args.checklist === undefined) {
    return { error: "nothing to change; pass text, color, checklist, or checks" };
  }
  // An identical request is acknowledged without bumping the version.
  return { changes: Object.keys(changes).length ? changes : null, droppedSavedChecks: dropped };
}

module.exports = { validateArgs: validateArgs, planUpdate: planUpdate, MAX_CHECKS: MAX_CHECKS };
