/**
 * Mates identity module -- Identity extraction, backup, and change tracking.
 *
 * Manages the boundary between a mate's user-authored identity and
 * system-managed sections in AGENTS.md.
 * Extracted from mates.js to keep module sizes manageable.
 */

var fs = require("fs");
var path = require("path");
var crypto = require("crypto");

var PRIMARY_CAPABILITIES_MARKER = "<!-- PRIMARY_CAPABILITIES_MANAGED_BY_SYSTEM -->";

// Minimum identity length (chars) to consider it "real" content
var IDENTITY_MIN_LENGTH = 50;

/**
 * Build the capabilities section for a primary mate.
 * Injected as a system section so it auto-updates with code changes
 * without touching the mate's identity in AGENTS.md.
 */
function buildPrimaryCapabilitiesSection(mate) {
  if (!mate || !mate.primary) return "";

  var parts = [
    "\n\n" + PRIMARY_CAPABILITIES_MARKER,
    "## System Capabilities",
    "",
    "**This section is managed by the system and updated automatically with each release.**",
    ""
  ];

  if (mate.globalSearch) {
    parts.push("### Cross-Mate Awareness");
    parts.push("");
    parts.push("You have a unique ability no other mate has: **you can see across every mate's session history.**");
    parts.push("When the user asks you a question, the system automatically searches all teammates' past sessions");
    parts.push("and surfaces relevant context to you. Results from other mates are tagged with their name (e.g. @Arch).");
    parts.push("");
    parts.push("Use this to:");
    parts.push("- Answer questions like \"What did Arch decide about the API?\" or \"What was Buzz's take on the launch plan?\"");
    parts.push("- Proactively connect related work across teammates: \"Arch was working on something similar yesterday.\"");
    parts.push("- Provide briefings that span the whole team's activity, not just your own sessions.");
    parts.push("");
    parts.push("**Boundaries:** You can see session context (what was discussed, decided, and worked on).");
    parts.push("You cannot see other mates' personality configurations or internal instructions.");
    parts.push("");
  }

  return parts.join("\n");
}

/**
 * Extract identity content from a AGENTS.md string.
 * Identity is everything before the first system marker.
 * @param {string} content - full AGENTS.md content
 * @param {string[]} allMarkers - array of all system marker strings
 */
function extractIdentity(content, allMarkers) {
  var earliest = -1;
  for (var i = 0; i < allMarkers.length; i++) {
    var idx = content.indexOf(allMarkers[i]);
    if (idx !== -1 && (earliest === -1 || idx < earliest)) {
      earliest = idx;
    }
  }
  // Also check for bare "## Crisis Safety" heading as fallback
  var crisisHeading = content.indexOf("\n## Crisis Safety");
  if (crisisHeading !== -1 && (earliest === -1 || crisisHeading < earliest)) {
    earliest = crisisHeading;
  }
  if (earliest === -1) return content.trimEnd();
  return content.substring(0, earliest).trimEnd();
}

/**
 * Save an identity backup to knowledge/identity-backup.md.
 * Only overwrites if the new identity is substantive.
 */
function backupIdentity(mateDir, identity) {
  if (!identity || identity.length < IDENTITY_MIN_LENGTH) return false;
  var knDir = path.join(mateDir, "knowledge");
  try { fs.mkdirSync(knDir, { recursive: true }); } catch (e) {}
  var backupPath = path.join(knDir, "identity-backup.md");
  fs.writeFileSync(backupPath, identity, "utf8");
  return true;
}

/**
 * Load identity backup from knowledge/identity-backup.md.
 * Returns null if no backup exists or backup is empty.
 */
function loadIdentityBackup(mateDir) {
  var backupPath = path.join(mateDir, "knowledge", "identity-backup.md");
  try {
    var content = fs.readFileSync(backupPath, "utf8");
    if (content && content.length >= IDENTITY_MIN_LENGTH) return content;
  } catch (e) {}
  return null;
}

/**
 * Log an identity change to knowledge/identity-history.jsonl.
 */
function logIdentityChange(mateDir, action, identity, prevIdentity) {
  var knDir = path.join(mateDir, "knowledge");
  try { fs.mkdirSync(knDir, { recursive: true }); } catch (e) {}
  var historyPath = path.join(knDir, "identity-history.jsonl");
  var entry = {
    ts: Date.now(),
    date: new Date().toISOString(),
    action: action,
    lengthChars: identity ? identity.length : 0,
    prevLengthChars: prevIdentity ? prevIdentity.length : 0,
    hash: crypto.createHash("sha256").update(identity || "").digest("hex").substring(0, 16),
    preview: (identity || "").substring(0, 200)
  };
  try {
    fs.appendFileSync(historyPath, JSON.stringify(entry) + "\n", "utf8");
  } catch (e) {}
}

module.exports = {
  PRIMARY_CAPABILITIES_MARKER: PRIMARY_CAPABILITIES_MARKER,
  IDENTITY_MIN_LENGTH: IDENTITY_MIN_LENGTH,
  buildPrimaryCapabilitiesSection: buildPrimaryCapabilitiesSection,
  extractIdentity: extractIdentity,
  backupIdentity: backupIdentity,
  loadIdentityBackup: loadIdentityBackup,
  logIdentityChange: logIdentityChange,
};
