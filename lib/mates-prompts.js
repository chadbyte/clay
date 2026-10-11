/**
 * Mates prompts module -- System section enforcers for mate AGENTS.md files.
 *
 * Each enforcer manages a specific system-managed section (team awareness,
 * session memory, sticky notes, project registry, debate awareness).
 * Extracted from mates.js to keep module sizes manageable.
 */

var fs = require("fs");
var path = require("path");
var crisisSafety = require("./crisis-safety");

// --- Marker constants ---

var TEAM_MARKER = "<!-- TEAM_AWARENESS_MANAGED_BY_SYSTEM -->";

var TEAM_SECTION =
  "\n\n" + TEAM_MARKER + "\n" +
  "## Your Team\n\n" +
  "**This section is managed by the system and cannot be removed.**\n\n" +
  "You are one of several AI Mates in this workspace. Your teammates and their profiles are listed in `../mates.json`. " +
  "Each teammate's identity and working style is described in their own directory:\n\n" +
  "- `../{mate_id}/AGENTS.md` -- their identity, personality, and working style\n" +
  "- `../{mate_id}/mate.yaml` -- their metadata (name, role, status, activities)\n" +
  "- `../common-knowledge.json` -- shared knowledge registry; files listed here are readable by all mates\n\n" +
  "Check the team registry when it would be relevant to know who else is available or what they do. " +
  "You cannot message other Mates directly yet, but knowing your team helps you work with the user more effectively.\n";

var SESSION_MEMORY_MARKER = "<!-- SESSION_MEMORY_MANAGED_BY_SYSTEM -->";

var SESSION_MEMORY_SECTION =
  "\n\n" + SESSION_MEMORY_MARKER + "\n" +
  "## Session Memory\n\n" +
  "Your identity is stored in `AGENTS.md` in your Mate directory. Read and edit that file when reshaping your identity; do not create a separate `CLAUDE.md`.\n\n" +
  "**This section is managed by the system and cannot be removed.**\n\n" +
  "Your `knowledge/memory-summary.md` file contains your compressed long-term memory, " +
  "automatically maintained across sessions. Refer to it for context about past " +
  "interactions, decisions, and patterns.\n\n" +
  "Your `knowledge/session-digests.jsonl` file contains raw session logs as an archive. " +
  "You do not need to read it routinely. Only access it when you need to look up " +
  "specific details from a past session that are not in the summary.\n";

var STICKY_NOTES_MARKER = "<!-- STICKY_NOTES_MANAGED_BY_SYSTEM -->";

var STICKY_NOTES_SECTION =
  "\n\n" + STICKY_NOTES_MARKER + "\n" +
  "## Sticky Notes\n\n" +
  "**This section is managed by the system and cannot be removed.**\n\n" +
  "Your `knowledge/sticky-notes.md` file is shared project memory that persists across sessions. " +
  "It may contain checklists, to-do items, work goals, handoffs, unfinished work, durable decisions and constraints, or project knowledge that future sessions should remember. " +
  "Read this file when starting a conversation and use relevant notes to recover the current context and next actions. " +
  "These notes are read-only. You cannot create, update, or delete them.\n";

var PROJECT_REGISTRY_MARKER = "<!-- PROJECT_REGISTRY_MANAGED_BY_SYSTEM -->";

var DEBATE_AWARENESS_MARKER = "<!-- DEBATE_AWARENESS_MANAGED_BY_SYSTEM -->";

var DEBATE_AWARENESS_SECTION =
  "\n\n" + DEBATE_AWARENESS_MARKER + "\n" +
  "## Proposing Debates\n\n" +
  "**This section is managed by the system and cannot be removed.**\n\n" +
  "When the user suggests a debate, you MUST use the `propose_debate` tool. " +
  "NEVER write debate files to disk. NEVER mkdir for debates. NEVER use Write/Bash for debate setup. " +
  "The ONLY way to propose a debate is the `propose_debate` tool.\n\n" +
  "**How to propose a debate:**\n" +
  "Call the `propose_debate` tool with these parameters:\n" +
  "- `topic` (required): The refined debate topic\n" +
  "- `format`: Debate format, default \"free_discussion\"\n" +
  "- `context`: Key context from the conversation that panelists should know\n" +
  "- `specialRequests`: Any special instructions\n" +
  "- `panelists` (required): A JSON string array of panelist objects:\n" +
  "  `[{\"mateId\": \"<mate UUID from team roster>\", \"role\": \"perspective\", \"brief\": \"guidance\"}]`\n\n" +
  "The user will see an inline approval card. The tool blocks until they approve or cancel.\n\n" +
  "**Rules:**\n" +
  "- Choose 2-4 panelists from the team roster. Pick mates whose expertise fits the topic.\n" +
  "- Do NOT include yourself as a panelist. You will moderate the debate.\n" +
  "- Only propose a debate when the user explicitly asks for one.\n" +
  "- Do NOT write files to disk for debate proposals. Always use the propose_debate tool.\n";

var ALL_SYSTEM_MARKERS = [TEAM_MARKER, PROJECT_REGISTRY_MARKER, "<!-- PRIMARY_CAPABILITIES_MANAGED_BY_SYSTEM -->", SESSION_MEMORY_MARKER, STICKY_NOTES_MARKER, DEBATE_AWARENESS_MARKER, crisisSafety.MARKER];

// --- Team awareness ---

/**
 * Build a dynamic team section with current mate roster.
 * @param {object} ctx - user context for loading mates
 * @param {string} currentMateId - this mate's ID (excluded from the roster)
 * @param {function} loadMates - function to load mates data
 * @returns {string} Team section string, or static TEAM_SECTION as fallback
 */
function buildTeamSection(ctx, currentMateId, loadMates) {
  var data;
  try { data = loadMates(ctx); } catch (e) { return TEAM_SECTION; }
  if (!data || !data.mates || data.mates.length < 2) return TEAM_SECTION;

  var mates = data.mates.filter(function (m) {
    return m.id !== currentMateId && m.status === "ready";
  });
  if (mates.length === 0) return TEAM_SECTION;

  var section = "\n\n" + TEAM_MARKER + "\n" +
    "## Your Team\n\n" +
    "**This section is managed by the system and updated automatically.**\n\n" +
    "You are one of " + (mates.length + 1) + " AI Mates in this workspace. " +
    "Here is your current team roster:\n\n" +
    "| Name | ID | Bio |\n" +
    "|------|-----|-----|\n";

  for (var i = 0; i < mates.length; i++) {
    var m = mates[i];
    var name = (m.profile && m.profile.displayName) || m.name || "Unnamed";
    var bio = (m.bio || "").replace(/\|/g, "/").replace(/\n/g, " ");
    if (bio.length > 120) bio = bio.substring(0, 117) + "...";
    section += "| " + name + " | `" + m.id + "` | " + bio + " |\n";
  }

  section += "\n" +
    "Each teammate's full identity is in their own directory:\n\n" +
    "- `../{mate_id}/AGENTS.md` -- identity, personality, working style\n" +
    "- `../{mate_id}/mate.yaml` -- metadata (name, role, status, activities)\n" +
    "- `../common-knowledge.json` -- shared knowledge readable by all mates\n\n" +
    "Use the **ID** (not the name) when referencing teammates in structured data. " +
    "Names can change, IDs are permanent.\n";

  return section;
}

function hasTeamSection(content) {
  return content.indexOf(TEAM_MARKER) !== -1;
}

function enforceTeamAwareness(filePath) {
  if (!fs.existsSync(filePath)) return false;

  var content = fs.readFileSync(filePath, "utf8");

  var teamIdx = content.indexOf(TEAM_MARKER);
  if (teamIdx !== -1) {
    var afterTeam = content.substring(teamIdx);
    var nextMarkerIdx = -1;
    var projIdx = afterTeam.indexOf(PROJECT_REGISTRY_MARKER);
    var memIdx = afterTeam.indexOf(SESSION_MEMORY_MARKER);
    var crisisIdx = afterTeam.indexOf(crisisSafety.MARKER);
    var teamNextCandidates = [projIdx, memIdx, crisisIdx];
    for (var tn = 0; tn < teamNextCandidates.length; tn++) {
      if (teamNextCandidates[tn] !== -1 && (nextMarkerIdx === -1 || teamNextCandidates[tn] < nextMarkerIdx)) {
        nextMarkerIdx = teamNextCandidates[tn];
      }
    }
    var existing;
    if (nextMarkerIdx !== -1) {
      existing = afterTeam.substring(0, nextMarkerIdx).trimEnd();
    } else {
      existing = afterTeam.trimEnd();
    }
    if (existing === TEAM_SECTION.trimStart().trimEnd()) return false;

    var endOfTeam = nextMarkerIdx !== -1 ? teamIdx + nextMarkerIdx : content.length;
    content = content.substring(0, teamIdx).trimEnd() + content.substring(endOfTeam);
  }

  var insertBefore = -1;
  var teamInsertCandidates = [PROJECT_REGISTRY_MARKER, SESSION_MEMORY_MARKER, STICKY_NOTES_MARKER, DEBATE_AWARENESS_MARKER, crisisSafety.MARKER];
  for (var ti = 0; ti < teamInsertCandidates.length; ti++) {
    var tip = content.indexOf(teamInsertCandidates[ti]);
    if (tip !== -1) { insertBefore = tip; break; }
  }
  if (insertBefore !== -1) {
    content = content.substring(0, insertBefore).trimEnd() + TEAM_SECTION + "\n\n" + content.substring(insertBefore);
  } else {
    content = content.trimEnd() + TEAM_SECTION;
  }

  fs.writeFileSync(filePath, content, "utf8");
  return true;
}

// --- Project registry ---

function buildProjectRegistrySection(projects) {
  if (!projects || projects.length === 0) return "";
  var section = "\n\n" + PROJECT_REGISTRY_MARKER + "\n" +
    "## Available Projects\n\n" +
    "**This section is managed by the system and cannot be removed.**\n\n" +
    "The following projects are registered in this workspace. " +
    "Use this information when the user references a project by name, " +
    "so you do not need to ask for the path.\n\n" +
    "| Project | Path |\n" +
    "|---------|------|\n";
  for (var i = 0; i < projects.length; i++) {
    var p = projects[i];
    var name = (p.icon ? p.icon + " " : "") + (p.title || p.slug || path.basename(p.path));
    section += "| " + name + " | `" + p.path + "` |\n";
  }
  return section;
}

function enforceProjectRegistry(filePath, projects) {
  if (!fs.existsSync(filePath)) return false;

  var content = fs.readFileSync(filePath, "utf8");
  var newSection = buildProjectRegistrySection(projects);

  var markerIdx = content.indexOf(PROJECT_REGISTRY_MARKER);
  if (markerIdx !== -1) {
    var afterMarker = content.substring(markerIdx);
    var nextIdx = -1;
    var candidates = [SESSION_MEMORY_MARKER, STICKY_NOTES_MARKER, DEBATE_AWARENESS_MARKER, crisisSafety.MARKER];
    for (var c = 0; c < candidates.length; c++) {
      var ci = afterMarker.indexOf(candidates[c]);
      if (ci !== -1 && (nextIdx === -1 || ci < nextIdx)) nextIdx = ci;
    }

    if (nextIdx !== -1) {
      var existing = afterMarker.substring(0, nextIdx).trimEnd();
      if (existing === newSection.trimStart().trimEnd()) return false;
      content = content.substring(0, markerIdx).trimEnd() + content.substring(markerIdx + nextIdx);
    } else {
      var existing = afterMarker.trimEnd();
      if (existing === newSection.trimStart().trimEnd()) return false;
      content = content.substring(0, markerIdx).trimEnd();
    }
  }

  if (!newSection) {
    if (markerIdx !== -1) {
      fs.writeFileSync(filePath, content, "utf8");
      return true;
    }
    return false;
  }

  var insertBefore = -1;
  var insertCandidates = [SESSION_MEMORY_MARKER, STICKY_NOTES_MARKER, DEBATE_AWARENESS_MARKER, crisisSafety.MARKER];
  for (var ic = 0; ic < insertCandidates.length; ic++) {
    var pos = content.indexOf(insertCandidates[ic]);
    if (pos !== -1) { insertBefore = pos; break; }
  }
  if (insertBefore !== -1) {
    content = content.substring(0, insertBefore).trimEnd() + newSection + "\n\n" + content.substring(insertBefore);
  } else {
    content = content.trimEnd() + newSection;
  }

  fs.writeFileSync(filePath, content, "utf8");
  return true;
}

// --- Session memory ---

function hasSessionMemory(content) {
  return content.indexOf(SESSION_MEMORY_MARKER) !== -1;
}

function enforceSessionMemory(filePath) {
  if (!fs.existsSync(filePath)) return false;

  var content = fs.readFileSync(filePath, "utf8");

  var memIdx = content.indexOf(SESSION_MEMORY_MARKER);
  if (memIdx !== -1) {
    var afterMem = content.substring(memIdx);
    var nextMemIdx = -1;
    var memNextCandidates = [STICKY_NOTES_MARKER, DEBATE_AWARENESS_MARKER, crisisSafety.MARKER];
    for (var mn = 0; mn < memNextCandidates.length; mn++) {
      var mni = afterMem.indexOf(memNextCandidates[mn]);
      if (mni !== -1 && (nextMemIdx === -1 || mni < nextMemIdx)) nextMemIdx = mni;
    }
    var existing;
    if (nextMemIdx !== -1) {
      existing = afterMem.substring(0, nextMemIdx).trimEnd();
    } else {
      existing = afterMem.trimEnd();
    }
    if (existing === SESSION_MEMORY_SECTION.trimStart().trimEnd()) return false;

    var endOfMem = nextMemIdx !== -1 ? memIdx + nextMemIdx : content.length;
    content = content.substring(0, memIdx).trimEnd() + content.substring(endOfMem);
  }

  var memInsertBefore = -1;
  var memInsertCandidates = [STICKY_NOTES_MARKER, DEBATE_AWARENESS_MARKER, crisisSafety.MARKER];
  for (var mi = 0; mi < memInsertCandidates.length; mi++) {
    var mip = content.indexOf(memInsertCandidates[mi]);
    if (mip !== -1) { memInsertBefore = mip; break; }
  }
  if (memInsertBefore !== -1) {
    content = content.substring(0, memInsertBefore).trimEnd() + SESSION_MEMORY_SECTION + "\n\n" + content.substring(memInsertBefore);
  } else {
    content = content.trimEnd() + SESSION_MEMORY_SECTION;
  }

  fs.writeFileSync(filePath, content, "utf8");
  return true;
}

// --- Sticky notes ---

function hasStickyNotesSection(content) {
  return content.indexOf(STICKY_NOTES_MARKER) !== -1;
}

function enforceStickyNotes(filePath) {
  if (!fs.existsSync(filePath)) return false;

  var content = fs.readFileSync(filePath, "utf8");

  var markerIdx = content.indexOf(STICKY_NOTES_MARKER);
  if (markerIdx !== -1) {
    var afterMarker = content.substring(markerIdx);
    var stickyNextIdx = -1;
    var stickyNextCandidates = [DEBATE_AWARENESS_MARKER, crisisSafety.MARKER];
    for (var sn = 0; sn < stickyNextCandidates.length; sn++) {
      var sni = afterMarker.indexOf(stickyNextCandidates[sn]);
      if (sni !== -1 && (stickyNextIdx === -1 || sni < stickyNextIdx)) stickyNextIdx = sni;
    }
    var existing;
    if (stickyNextIdx !== -1) {
      existing = afterMarker.substring(0, stickyNextIdx).trimEnd();
    } else {
      existing = afterMarker.trimEnd();
    }
    if (existing === STICKY_NOTES_SECTION.trimStart().trimEnd()) return false;

    var endOfSection = stickyNextIdx !== -1 ? markerIdx + stickyNextIdx : content.length;
    content = content.substring(0, markerIdx).trimEnd() + content.substring(endOfSection);
  }

  var stickyInsertBefore = -1;
  var stickyInsertCandidates = [DEBATE_AWARENESS_MARKER, crisisSafety.MARKER];
  for (var si = 0; si < stickyInsertCandidates.length; si++) {
    var sip = content.indexOf(stickyInsertCandidates[si]);
    if (sip !== -1) { stickyInsertBefore = sip; break; }
  }
  if (stickyInsertBefore !== -1) {
    content = content.substring(0, stickyInsertBefore).trimEnd() + STICKY_NOTES_SECTION + "\n\n" + content.substring(stickyInsertBefore);
  } else {
    content = content.trimEnd() + STICKY_NOTES_SECTION;
  }

  fs.writeFileSync(filePath, content, "utf8");
  return true;
}

// --- Debate awareness ---

function enforceDebateAwareness(filePath) {
  if (!fs.existsSync(filePath)) return false;

  var content = fs.readFileSync(filePath, "utf8");

  var markerIdx = content.indexOf(DEBATE_AWARENESS_MARKER);
  if (markerIdx !== -1) {
    var afterMarker = content.substring(markerIdx);
    var crisisIdx = afterMarker.indexOf(crisisSafety.MARKER);
    var existing;
    if (crisisIdx !== -1) {
      existing = afterMarker.substring(0, crisisIdx).trimEnd();
    } else {
      existing = afterMarker.trimEnd();
    }
    if (existing === DEBATE_AWARENESS_SECTION.trimStart().trimEnd()) return false;

    var endOfSection = crisisIdx !== -1 ? markerIdx + crisisIdx : content.length;
    content = content.substring(0, markerIdx).trimEnd() + content.substring(endOfSection);
  }

  var crisisPos = content.indexOf(crisisSafety.MARKER);
  if (crisisPos !== -1) {
    content = content.substring(0, crisisPos).trimEnd() + DEBATE_AWARENESS_SECTION + "\n\n" + content.substring(crisisPos);
  } else {
    content = content.trimEnd() + DEBATE_AWARENESS_SECTION;
  }

  fs.writeFileSync(filePath, content, "utf8");
  return true;
}

module.exports = {
  TEAM_MARKER: TEAM_MARKER,
  TEAM_SECTION: TEAM_SECTION,
  SESSION_MEMORY_MARKER: SESSION_MEMORY_MARKER,
  SESSION_MEMORY_SECTION: SESSION_MEMORY_SECTION,
  STICKY_NOTES_MARKER: STICKY_NOTES_MARKER,
  STICKY_NOTES_SECTION: STICKY_NOTES_SECTION,
  PROJECT_REGISTRY_MARKER: PROJECT_REGISTRY_MARKER,
  DEBATE_AWARENESS_MARKER: DEBATE_AWARENESS_MARKER,
  DEBATE_AWARENESS_SECTION: DEBATE_AWARENESS_SECTION,
  ALL_SYSTEM_MARKERS: ALL_SYSTEM_MARKERS,
  buildTeamSection: buildTeamSection,
  hasTeamSection: hasTeamSection,
  enforceTeamAwareness: enforceTeamAwareness,
  buildProjectRegistrySection: buildProjectRegistrySection,
  enforceProjectRegistry: enforceProjectRegistry,
  hasSessionMemory: hasSessionMemory,
  enforceSessionMemory: enforceSessionMemory,
  hasStickyNotesSection: hasStickyNotesSection,
  enforceStickyNotes: enforceStickyNotes,
  enforceDebateAwareness: enforceDebateAwareness,
};
