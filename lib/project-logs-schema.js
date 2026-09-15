// Vocabulary and validation for Project Logs.
//
// Extracted from project-logs-store.js so the store stays focused on records
// and stays inside the module size limit.
//
// Two independent axes, deliberately:
//   category - what kind of record this is, a project-local vocabulary
//   priority - how much it matters, a stable global enum
// Conflating them is what made "an urgent decision" unrepresentable before.
//
// Category is NOT a global enum. Every project evolves its own vocabulary: an
// agent reuses an established category when one fits and coins a new one when
// the project needs a durable distinction it does not yet have. What is fixed
// is only the shape of a category label, not the set of labels. The seeds
// below are guidance for a project with no history yet, never a whitelist.

// Suggested starting points, surfaced in tool guidance only.
var SEED_CATEGORIES = [
  "decision",
  "security",
  "idea",
  "operations",
  "incident",
  "investigation",
  "progress",
  "reference",
];

var MAX_CATEGORY_CHARS = 32;
// Letters and digits in any script, so a project can keep its vocabulary in the
// language it actually works in. Normalization runs server-side only, so this
// depends on Node's Unicode property escapes and never on a browser baseline.
var CATEGORY_PATTERN = /^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u;
var CATEGORY_STRIP = /[^\p{L}\p{N}-]/gu;

// Length is counted in code points, not UTF-16 units, so a CJK or Hangul label
// is bounded the same way a Latin one is.
function codePointLength(value) {
  return Array.from(value).length;
}

// Deterministic normalization to a lowercase, hyphen-separated label. Anything
// that cannot be reduced to a safe label is rejected rather than silently
// coerced, so a caller is told when its input was unusable instead of getting a
// surprising slug.
//
// Path and identity shapes are refused outright: a category is dry metadata and
// must never be able to carry a slug, a path segment, or a user id.
function normalizeCategory(value) {
  if (typeof value !== "string") throw new Error("A log category must be a string.");
  var raw = value.normalize("NFC").trim();
  if (!raw) throw new Error("A log category is required.");
  if (codePointLength(raw) > MAX_CATEGORY_CHARS * 2) {
    throw new Error("A log category must be " + MAX_CATEGORY_CHARS + " characters or fewer.");
  }
  if (/[\/\\]/.test(raw) || raw.indexOf("..") !== -1) {
    throw new Error("A log category cannot contain path characters.");
  }
  var slug = raw
    .toLowerCase()
    .replace(/[_\s]+/g, "-")
    .replace(CATEGORY_STRIP, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (!slug) throw new Error("A log category must contain letters or digits: " + value);
  if (codePointLength(slug) > MAX_CATEGORY_CHARS) {
    throw new Error("A log category must be " + MAX_CATEGORY_CHARS + " characters or fewer.");
  }
  if (!CATEGORY_PATTERN.test(slug)) throw new Error("Invalid log category: " + value);
  return slug;
}

// Non-throwing form for reading stored records, where a corrupt on-disk value
// should make that record unusable rather than break the whole projection.
// Filters deliberately do NOT use this: a caller that supplies a malformed
// category is told so.
function safeCategory(value) {
  try {
    return normalizeCategory(value);
  } catch (e) {
    return null;
  }
}

var PRIORITIES = ["normal", "important", "urgent"];
var DEFAULT_PRIORITY = "normal";

var MAX_SUMMARY_CHARS = 400;

function isPriority(value) {
  return PRIORITIES.indexOf(value) !== -1;
}

function normalizePriority(value) {
  return isPriority(value) ? value : DEFAULT_PRIORITY;
}

// A summary for an entry written before summaries existed. Deterministic and
// derived from stored content only, so the same record always yields the same
// text and nothing is invented.
function fallbackSummary(entry) {
  if (!entry) return "";
  if (typeof entry.summary === "string" && entry.summary.trim()) {
    return entry.summary.trim().substring(0, MAX_SUMMARY_CHARS);
  }
  // Prefer the first line of prose. A leading Markdown heading usually just
  // restates the title, so it is only used when there is nothing else.
  var body = typeof entry.body === "string" ? entry.body : "";
  var lines = body.split("\n");
  var heading = "";
  var firstLine = "";
  for (var i = 0; i < lines.length; i++) {
    var raw = lines[i].trim();
    if (!raw) continue;
    var isHeading = raw.charAt(0) === "#";
    var line = raw.replace(/^#+\s*/, "").replace(/^[-*>]\s*/, "").trim();
    if (!line) continue;
    if (isHeading) {
      if (!heading) heading = line;
      continue;
    }
    firstLine = line;
    break;
  }
  if (!firstLine) firstLine = heading;
  if (!firstLine) return "";
  return firstLine.length > MAX_SUMMARY_CHARS
    ? firstLine.substring(0, MAX_SUMMARY_CHARS)
    : firstLine;
}

// Validation for a new agent-written record. Category, title, and summary are
// all required: a log without a summary cannot be understood from a list, and
// that is the whole point of the surface.
function validateNewRecord(input) {
  var data = input || {};
  var category = normalizeCategory(data.category || data.kind);
  if (typeof data.title !== "string" || !data.title.trim()) throw new Error("A log title is required.");
  if (typeof data.summary !== "string" || !data.summary.trim()) {
    throw new Error("A one or two sentence summary is required so the entry is understandable from a list.");
  }
  // A mistyped priority is refused rather than silently downgraded to normal:
  // an agent that meant "urgent" must not get "normal" without being told.
  if (data.priority !== undefined && data.priority !== null && !isPriority(data.priority)) {
    throw new Error("Unknown log priority: " + data.priority);
  }
  return {
    category: category,
    priority: normalizePriority(data.priority),
  };
}

// Validation for a revision. The category may move to another writable value
// or stay on its legacy one; nothing is required, but nothing may be emptied.
function validateRevision(input) {
  var data = input || {};
  var out = {};
  if (data.category !== undefined || data.kind !== undefined) {
    out.category = normalizeCategory(data.category || data.kind);
  }
  if (data.priority !== undefined) {
    if (!isPriority(data.priority)) throw new Error("Unknown log priority: " + data.priority);
    out.priority = data.priority;
  }
  if (data.title !== undefined) {
    if (typeof data.title !== "string" || !data.title.trim()) throw new Error("A log title cannot be emptied.");
    out.title = data.title;
  }
  if (data.summary !== undefined) {
    if (typeof data.summary !== "string" || !data.summary.trim()) throw new Error("A log summary cannot be emptied.");
    out.summary = data.summary;
  }
  return out;
}


// --- Normalization -------------------------------------------------------
//
// Moved here from project-logs-store.js so the store stays inside the module
// size limit. These are pure text and shape helpers with no record semantics.

var MAX_TAGS = 12;
var MAX_TAG_CHARS = 40;
var MAX_LINKS = 20;
var MAX_LINK_CHARS = 200;

function cleanText(value, max) {
  if (typeof value !== "string") return "";
  var text = value.replace(/\u0000/g, "").trim();
  return text.length > max ? text.substring(0, max) : text;
}

function cleanLine(value, max) {
  return cleanText(value, max).replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeAuthor(author) {
  var source = author || {};
  var type = source.type === "user" ? "user" : (source.type === "system" ? "system" : "session");
  return {
    type: type,
    userId: source.userId ? cleanLine(String(source.userId), 120) : null,
    displayName: cleanLine(source.displayName || "", 120) || null,
    sessionKey: source.sessionKey ? cleanLine(String(source.sessionKey), 200) : null,
    vendor: cleanLine(source.vendor || "", 40) || null,
  };
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) return [];
  var out = [];
  for (var i = 0; i < tags.length && out.length < MAX_TAGS; i++) {
    var tag = cleanLine(String(tags[i] == null ? "" : tags[i]), MAX_TAG_CHARS).toLowerCase();
    if (tag && out.indexOf(tag) === -1) out.push(tag);
  }
  return out;
}

function normalizeLinks(links) {
  if (!Array.isArray(links)) return [];
  var out = [];
  for (var i = 0; i < links.length && out.length < MAX_LINKS; i++) {
    var raw = links[i];
    var value = typeof raw === "string" ? { ref: raw } : (raw || {});
    var ref = cleanLine(String(value.ref || value.sessionRef || ""), MAX_LINK_CHARS);
    if (!ref) continue;
    var label = cleanLine(value.label || "", MAX_LINK_CHARS) || null;
    var duplicate = false;
    for (var j = 0; j < out.length; j++) {
      if (out[j].ref === ref) { duplicate = true; break; }
    }
    if (!duplicate) out.push({ ref: ref, label: label });
  }
  return out;
}

module.exports = {
  SEED_CATEGORIES: SEED_CATEGORIES,
  MAX_CATEGORY_CHARS: MAX_CATEGORY_CHARS,
  CATEGORY_PATTERN: CATEGORY_PATTERN,
  codePointLength: codePointLength,
  normalizeCategory: normalizeCategory,
  safeCategory: safeCategory,
  PRIORITIES: PRIORITIES,
  DEFAULT_PRIORITY: DEFAULT_PRIORITY,
  MAX_SUMMARY_CHARS: MAX_SUMMARY_CHARS,
  isPriority: isPriority,
  normalizePriority: normalizePriority,
  fallbackSummary: fallbackSummary,
  MAX_TAGS: MAX_TAGS,
  MAX_LINKS: MAX_LINKS,
  cleanText: cleanText,
  cleanLine: cleanLine,
  normalizeAuthor: normalizeAuthor,
  normalizeTags: normalizeTags,
  normalizeLinks: normalizeLinks,
  validateNewRecord: validateNewRecord,
  validateRevision: validateRevision,
};
