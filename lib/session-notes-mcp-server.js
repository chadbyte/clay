// Sticky-note memory tools for project sessions.

var buildShape = require("./session-spawn-mcp-server").buildShape;
var z;
try { z = require("zod"); } catch (e) { z = null; }

var BOARD_INTRO = "The sticky-note board persists across sessions and is a user-facing artifact shared with people and Clay agents, not private agent scratch space. ";
var NEVER_CREATE =
  "Never create a note merely because work is important, lengthy, spans agents or restarts, or might help another agent. Do not record completed work, implementation details, test results, investigation logs, transient blockers, conversation summaries, or announcements of your own activity. When uncertain, do not write. " +
  "One exception: when the user explicitly asks for a working checklist, keep that one native checklist note and check its items off as they are done; never start a checklist the user did not ask for. " +
  "Updates are visible too: update only when durable state materially changes. " +
  "A note is an attention item, so finishing it means closing it, never erasing it: call close_note once the thing it is asking for is done, and the note leaves the active board while the record stays and can be reopened. Do not turn a note into a completion log instead of closing it. " +
  "Put a concise plain-text title on the first line, stay focused on one topic, and include only the context needed for future action.";

// options.linked: keep the confirmed-Issue link note exception (default true).
// options.mode "request": write only when the user's message asks.
function memoryContract(options) {
  var linked = !options || options.linked !== false;
  if (options && options.mode === "request") {
    return BOARD_INTRO +
      "The user has set Sticky Notes to On request: create, update or close a note only when the user's message asks you to remember, track, change or close something on the board. Do not add notes on your own initiative, including notes that link Issues. Check active notes first when a duplicate is plausible. " +
      NEVER_CREATE;
  }
  return BOARD_INTRO +
    (linked ? "Except for confirmed Issue link notes described below, default to not writing. " : "Default to not writing. ") +
    "Create a note proactively only when the user explicitly asks to remember or track something, or when all of these are true: it will remain useful after the current task and session, it is not already adequately recorded in the repository, an Issue, or another note, and the user would likely be glad to find it on the board a week later. " +
    "Use Sticky Notes for preferences, reminders, undeveloped ideas, or an explicit request to remember something; " + (linked ? "confirmed Issues also get short link notes as described below. " : "") +
    "For concrete actionable bugs, improvements, or deferred implementation, an authorized Project Driver should use Project Issues. If you lack Issues authority, route the work through an eligible Project Driver. Check active notes first when a duplicate is plausible. " +
    (linked ? require("./issues-filing-guidance").NOTE_GUIDANCE : "") +
    NEVER_CREATE;
}

var MEMORY_CONTRACT = memoryContract();

var CHECKLIST_USAGE =
  " Native checklists: pass checklist: true to create one. The first line is the title and every later non-empty, non-heading line is an item; write items as '- [ ] task' and '- [x] task' for items already done. " +
  "To check or uncheck items, call list_notes, then pass id, that note's current version and checks with the exact item keys it returned. " +
  "Any change to a checklist note, switching checklist mode, or changing checks needs the current version; a stale version or unknown item is refused, so list again and retry. " +
  "Text, saved checks and colour you do not change are kept, and switching mode never erases content. Change text and checks in separate calls. " +
  "When rewriting a checklist's text, start from checklist.effectiveText so each line's - [x] marker carries its real completion; droppedSavedChecks lists saved checks whose exact line no longer exists.";

var CHECK_ENTRY = z ? z.object({
  item: z.string().describe("Exact item key from list_notes checklist.items[].item."),
  checked: z.boolean().describe("true marks the item done; false marks it not done."),
}) : null;

function getToolDefs(handlers, options) {
  var MEMORY_CONTRACT = memoryContract(options);
  var linked = !options || options.linked !== false;
  return [
    {
      name: "list_notes",
      description: MEMORY_CONTRACT + " List the notes before writing when you need to avoid duplicates or inspect full memory beyond the injected summary. Lists open notes by default; pass state to see closed ones. Each note includes its version and checklistMode; checklist notes also include checklist.items with exact item keys, each item's effective checked value (a saved check overrides the Markdown marker), its saved value, and completed/total counts.",
      inputSchema: buildShape({
        state: { type: "string", enum: ["open", "closed", "all"], description: "Which notes to list. Defaults to open, the notes still asking for action." },
      }),
      handler: function (args) { return handlers.list(args || {}); },
    },
    {
      name: "write_note",
      description: MEMORY_CONTRACT + " Create a new note, or update an existing note by id. For notes other than " + (linked ? "confirmed Issue link notes and " : "") + "a working checklist the user explicitly asked for, apply this test: would the user likely choose to keep this visible on their board next week? If the answer is unclear, do not call this tool. The 20000-character limit is an abuse guard, not a target." + CHECKLIST_USAGE,
      inputSchema: buildShape({
        id: { type: "string", description: "Existing note id to update. Omit to create a note." },
        text: { type: "string", description: "User-facing sticky-note text with a concise title on the first line and only durable, action-relevant context below it. Required when creating; omit on update to keep the current text." },
        color: { type: "string", enum: ["yellow", "blue", "green", "pink", "orange", "purple"], description: "Optional sticky-note color." },
        checklist: { type: "boolean", description: "true creates or switches to a native checklist, false switches back to an ordinary note. Switching keeps the text and saved checks." },
        version: { type: "number", description: "The note's current version from list_notes. Required for any change to a checklist note, a checklist mode switch, or checks." },
        // buildShape returns no fields when zod is unavailable.
        checks: { schema: CHECK_ENTRY && z.array(CHECK_ENTRY).min(1).max(1000), description: "Checklist items to check or uncheck on an existing checklist note, using exact item keys from list_notes." },
      }),
      handler: function (args) { return handlers.write(args || {}); },
    },
    {
      name: "close_note",
      description: MEMORY_CONTRACT + " Close a note once what it asked for is done. Authorized Project Drivers may close any note in their project, including notes created by people or other sessions. Other sessions may only close their own notes. Closing is not deletion: the note leaves the active board, stays queryable under state closed, and can be reopened.",
      inputSchema: buildShape({
        id: { type: "string", description: "Id of the note to close." },
      }, ["id"]),
      handler: function (args) { return handlers.close(args || {}); },
    },
    {
      name: "reopen_note",
      description: MEMORY_CONTRACT + " Reopen a closed note created by this same session when it turns out to still need action. The note returns to the active board unchanged.",
      inputSchema: buildShape({
        id: { type: "string", description: "Id of the note to reopen." },
      }, ["id"]),
      handler: function (args) { return handlers.reopen(args || {}); },
    },
    {
      name: "remove_note",
      description: MEMORY_CONTRACT + " Deprecated: use close_note. This tool no longer deletes anything and now closes the note instead, so an older caller cannot destroy a record. Same ownership rule as close_note.",
      inputSchema: buildShape({
        id: { type: "string", description: "Id of the note to close. Nothing is deleted." },
      }, ["id"]),
      handler: function (args) { return handlers.remove(args || {}); },
    },
  ];
}

module.exports = {
  // 2: native checklist fields. Conversation-scoped catalogs older than this
  // receive the current schema through exact-query recovery.
  CATALOG_VERSION: 2,
  MEMORY_CONTRACT: MEMORY_CONTRACT,
  memoryContract: memoryContract,
  getToolDefs: getToolDefs,
};
