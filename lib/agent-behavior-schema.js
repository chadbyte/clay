// Typed Personal "Agent behavior" policy: the one catalog the server validates
// against, the gate enforces, and the settings page renders from.
//
// Scope: a person's own Project Driver sessions. Mates never read this policy.
// Every setting is Off / On request / Auto except the dependent checkbox.
// Absent or malformed stored values resolve to the pre-existing behavior
// (Auto, and the Issue-linked note exception enabled), so upgrading changes
// nothing until the person chooses.

var MODES = ["off", "request", "auto"];
var MODE_LABELS = { off: "Off", request: "On request", auto: "Auto" };
var VERSION = 1;

var SECTIONS = [
  { id: "memory", label: "Memory & records", description: "What your Driver remembers about you and writes down in the project." },
  { id: "context", label: "Context", description: "Other conversations your Driver may draw on." },
  { id: "tools", label: "Tools", description: "Built-in tools your Driver may reach for." },
  { id: "connections", label: "Connections", description: "Links between a conversation and the services you connected." },
];

function mode(consequence, example) { return { consequence: consequence, example: example }; }

var SETTINGS = [
  { id: "meUse", section: "memory", type: "mode", label: "Use what Clay knows about me",
    description: "Reads your private Me knowledge (preferences and working principles Clay has saved).",
    modes: {
      off: mode("Your Driver gets no Me knowledge: it is not added to the conversation and the search and read tools are removed.", "\"Plan this the way I like\" gets a generic plan."),
      request: mode("Me knowledge is not added automatically. Your Driver can search it only when you ask it to recall or apply something about you.", "\"Check what you know about how I like commit messages.\""),
      auto: mode("Relevant Me knowledge is added to the conversation and your Driver searches it before substantial work.", "Your Driver follows your saved review preferences without being asked.") } },
  { id: "meCollection", section: "memory", type: "mode", label: "Suggest things to remember about me",
    description: "Lets your Driver report what you say about yourself to Clay for review. Nothing is saved until Clay's curator accepts it.",
    modes: {
      off: mode("Your Driver cannot report observations about you. The report tool is removed and refused.", "Telling it a preference does not create a pending observation."),
      request: mode("Your Driver reports an observation only when you ask it to remember something about you.", "\"Remember that I prefer short answers.\""),
      auto: mode("Your Driver reports durable preferences and corrections it notices, quoting your own words as evidence.", "You correct a naming habit once and it is proposed to Clay for review.") } },
  { id: "logs", section: "memory", type: "mode", label: "Project Logs",
    description: "The Logbook of task results, decisions and verification that your Driver writes for the project.",
    modes: {
      off: mode("Your Driver does not use the Logbook: its tools and instructions are removed. People can still read entries and add comments, which stay pending.", "\"Log what we decided\" is not available to the Driver."),
      request: mode("Your Driver writes or revises Logbook entries only when you ask it to record something.", "\"Add a Log entry for the migration.\""),
      auto: mode("Your Driver keeps a concise entry for each meaningful task and revises it at milestones.", "A finished bug fix leaves an entry with the result and how it was verified.") } },
  { id: "logsLearning", section: "memory", type: "mode", label: "Learning records",
    description: "The learning category of the Logbook: concepts you engaged with and now understand more precisely.",
    modes: {
      off: mode("Your Driver cannot create or revise learning entries. The Logbook itself is unchanged.", "A concept you worked through is not recorded as learning."),
      request: mode("Your Driver records a learning entry only when you ask for one.", "\"Save what I learned about idempotency as a learning record.\""),
      auto: mode("Your Driver records a learning entry when a concept you engaged with becomes clearer.", "A question about event ordering that you work through becomes a short learning entry.") } },
  { id: "issues", section: "memory", type: "mode", label: "Issues",
    description: "The project Issue tracker for concrete bugs, improvements and deferred work.",
    modes: {
      off: mode("Your Driver does not search, create or update Issues: its tools and instructions are removed. People still use the Issues tool normally.", "\"File an issue for that\" is not available to the Driver."),
      request: mode("Your Driver uses Issues only when you ask it to look something up, file it or update it.", "\"Create an issue for the flaky upload test.\""),
      auto: mode("Your Driver searches and reuses Issues, and files a new one when it finds an established defect or durable backlog item.", "A defect confirmed on the main branch is filed without you asking.") } },
  { id: "notes", section: "memory", type: "mode", label: "Sticky Notes",
    description: "The shared Sticky Notes board for reminders, preferences and undeveloped ideas.",
    modes: {
      off: mode("Your Driver does not see or write Sticky Notes: the board is not added to the conversation and the note tools are removed.", "\"Put a note on the board\" is not available to the Driver."),
      request: mode("Your Driver reads the board and writes a note only when you ask it to remember or track something.", "\"Leave a note to revisit the cache TTL.\""),
      auto: mode("Your Driver reads the board and may add a note when something will clearly matter after this task.", "A preference you mention for later lands on the board.") } },
  { id: "issueLinkedNotes", section: "memory", type: "checkbox", parent: "notes", label: "Add a linked note when an Issue is confirmed",
    description: "Lets your Driver add a short Sticky Note that points at a confirmed Issue. Only takes effect while Sticky Notes is Auto and Issues is not Off.",
    checked: "Your Driver adds one two-line note referencing each confirmed open Issue that needs action.",
    unchecked: "Confirmed Issues do not produce a note on the board.",
    example: "A newly filed Issue appears on the board as a one-line reminder with its reference." },

  { id: "sessionHistory", section: "context", type: "mode", label: "History from other sessions",
    description: "Lets your Driver look at other Driver conversations in the same project.",
    modes: {
      off: mode("Your Driver cannot list, search or read other conversations in this project. The tools are removed and refused.", "\"What did the other session decide?\" cannot be answered from that session."),
      request: mode("Your Driver looks at other conversations only when you point it at them.", "\"Check the auth session for what we agreed on.\""),
      auto: mode("Your Driver searches other conversations in the project when earlier work would help.", "It finds the earlier decision about token storage before changing it.") } },
  { id: "continuation", section: "context", type: "mode", label: "Continuation proposals",
    description: "Lets your Driver propose continuing a long conversation in a fresh one. You always review and approve the proposal.",
    modes: {
      off: mode("Your Driver never proposes a continuation. The tool and its instructions are removed.", "A very long conversation just keeps going."),
      request: mode("Your Driver proposes a continuation only when you ask for one.", "\"This is getting long. Propose a continuation.\""),
      auto: mode("Your Driver may propose a continuation when the conversation grows heavy, then waits for your approval.", "A card offers to continue in a new conversation with a summary.") } },

  { id: "sketch", section: "tools", type: "mode", label: "Clay Sketch",
    description: "Wireframes drawn in chat and the Sketch viewer.",
    modes: {
      off: mode("Your Driver does not draw Clay Sketch wireframes: the viewer tool, its instructions and the bundled Sketch skill are removed from its session.", "\"Show me a wireframe\" gets a text description."),
      request: mode("Your Driver draws a sketch only when you ask to see a wireframe or layout.", "\"Sketch the settings page.\""),
      auto: mode("Your Driver may draw a sketch to explain a layout or UI plan, and updates it in the viewer when you ask for changes.", "A UI discussion includes a sketch without being asked.") } },
  { id: "markdownViewer", section: "tools", type: "mode", label: "Markdown viewer",
    description: "Opens Markdown documents in the viewer for you to follow while they are edited.",
    modes: {
      off: mode("Your Driver does not open the Markdown viewer. The tool is removed and refused. Files are still edited normally.", "A document is edited without opening beside you."),
      request: mode("Your Driver opens a document in the viewer only when you ask to see it.", "\"Open the README in the viewer while you edit it.\""),
      auto: mode("Your Driver opens a document in the viewer when writing or revising Markdown is your main request.", "\"Rewrite the intro\" opens the file beside the chat.") } },
  { id: "sharedBrowser", section: "tools", type: "mode", label: "Shared Browser",
    description: "The browser panel your Driver and you both see and can control.",
    modes: {
      off: mode("Your Driver cannot open or use the Shared Browser. The tool is removed and refused, and a page already open is left alone.", "\"Check the page\" cannot be done in the browser."),
      request: mode("Your Driver uses the Shared Browser only when you ask it to open, test or inspect a page.", "\"Open localhost:3000 and click Save.\""),
      auto: mode("Your Driver may open pages to test or verify its work, narrating each step beside you.", "After a UI change it loads the page to confirm it renders.") } },
  { id: "workerProposals", section: "tools", type: "mode", label: "Worker proposals",
    description: "Suggestions to hand heavy work to a visible Split Worker. Each proposal is shown on a card; unless full access is on, you choose the runtime and accept it, and in full access Clay may auto-accept the exact validated recommendation. Managing an existing Worker, and Stop, are never affected.",
    modes: {
      off: mode("Your Driver does not propose new Split Workers: the proposal tool and the delegation nudges are removed. Existing Workers keep working.", "Heavy work stays in the Driver conversation."),
      request: mode("Your Driver proposes a Split Worker only when you ask for one.", "\"Propose a Worker to do the migration.\""),
      auto: mode("Your Driver proposes a Worker for implementation-heavy work before it starts, as it does today.", "A multi-module change opens a Worker proposal card first.") } },

  { id: "githubLinks", section: "connections", type: "mode", label: "GitHub session links",
    description: "Associates a conversation with the GitHub issue or pull request it is working on. Linking only labels the conversation; it does not write to GitHub.",
    modes: {
      off: mode("Your Driver does not link, unlink or look up GitHub links for a conversation. Links you made stay visible.", "A pull request you mention is not attached to the conversation."),
      request: mode("Your Driver links a conversation to GitHub only when you ask.", "\"Link this session to issue 482.\""),
      auto: mode("Your Driver links the issue or pull request as soon as it is clearly part of the work.", "Working on a review comment attaches that pull request.") } },
  { id: "linearLinks", section: "connections", type: "mode", label: "Linear session links",
    description: "Associates a conversation with the Linear issue it is working on. Linking only labels the conversation; it does not write to Linear. Reading and searching Linear issues stay available.",
    modes: {
      off: mode("Your Driver does not link, unlink or look up Linear links for a conversation. Links you made stay visible, and reading Linear issues still works.", "A Linear issue you mention is not attached to the conversation."),
      request: mode("Your Driver links a conversation to a Linear issue only when you ask.", "\"Link this session to CLAY-123.\""),
      auto: mode("Your Driver links the Linear issue as soon as it is clearly part of the work.", "Starting work on a Linear bug attaches that issue.") } },
];

var BY_ID = {};
SETTINGS.forEach(function (setting) { BY_ID[setting.id] = setting; });

function defaults() {
  var result = {};
  SETTINGS.forEach(function (setting) { result[setting.id] = setting.type === "checkbox" ? true : "auto"; });
  return result;
}

function validValue(setting, value) {
  if (!setting) return false;
  if (setting.type === "checkbox") return typeof value === "boolean";
  return typeof value === "string" && MODES.indexOf(value) !== -1;
}

// Stored data is never trusted: unknown keys are dropped and invalid values
// fall back to the default, so a corrupt record cannot disable anything.
function normalize(raw) {
  var result = defaults();
  var source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  Object.keys(BY_ID).forEach(function (id) {
    if (Object.prototype.hasOwnProperty.call(source, id) && validValue(BY_ID[id], source[id])) result[id] = source[id];
  });
  return result;
}

// The valid explicit choices only (no defaults filled in), used when merging.
function explicit(raw) {
  var result = {};
  var source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  Object.keys(BY_ID).forEach(function (id) {
    if (Object.prototype.hasOwnProperty.call(source, id) && validValue(BY_ID[id], source[id])) result[id] = source[id];
  });
  return result;
}

// Strict validation for a write. The whole change is refused when any key is
// unknown or any value is not allowed.
function validateChanges(changes) {
  if (!changes || typeof changes !== "object" || Array.isArray(changes)) return { error: "changes must be an object" };
  var keys = Object.keys(changes);
  if (!keys.length) return { error: "changes must name at least one setting" };
  if (keys.length > SETTINGS.length) return { error: "too many settings" };
  var clean = {};
  for (var i = 0; i < keys.length; i++) {
    var setting = Object.prototype.hasOwnProperty.call(BY_ID, keys[i]) ? BY_ID[keys[i]] : null;
    if (!setting) return { error: "Unknown setting: " + String(keys[i]).slice(0, 60) };
    if (!validValue(setting, changes[keys[i]])) return { error: "Invalid value for " + setting.id };
    clean[setting.id] = changes[keys[i]];
  }
  return { value: clean };
}

// The checkbox is only meaningful with Notes on Auto and Issues not Off.
function effective(policy) {
  var p = normalize(policy);
  return { issueLinkedNotes: p.issueLinkedNotes === true && p.notes === "auto" && p.issues !== "off" };
}

function catalog() {
  return { version: VERSION, modes: MODES.map(function (id) { return { id: id, label: MODE_LABELS[id] }; }), sections: SECTIONS, settings: SETTINGS };
}

module.exports = {
  MODES: MODES, MODE_LABELS: MODE_LABELS, VERSION: VERSION, SECTIONS: SECTIONS, SETTINGS: SETTINGS,
  defaults: defaults, normalize: normalize, explicit: explicit, validateChanges: validateChanges, effective: effective, catalog: catalog,
};
