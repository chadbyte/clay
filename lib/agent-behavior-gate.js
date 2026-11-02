// Runtime enforcement of the Personal "Agent behavior" policy for Project
// Driver sessions. Mates, canonical Clay and the Me curator never read it.
//
// Three layers share one live lookup so a change is honoured at the next
// catalog/prompt build and, for Off, at the next tool call of a turn already
// running:
//   1. catalogs: filterTools / filterBridgeTools / gateAdapter drop tools;
//   2. prompts: view(session) tells modules which instructions to include;
//   3. dispatch: every kept tool's handler re-reads the policy when called.
var schema = require("./agent-behavior-schema");

// Tool name -> the setting that governs it. "keepWhenOff" tools stay available
// but are told the person turned the behavior off.
var TOOL_SETTING = {
  search_user_knowledge: { id: "meUse" }, read_user_knowledge: { id: "meUse" },
  report_user_observation: { id: "meCollection" },
  list_logs: { id: "logs" }, search_logs: { id: "logs" }, read_log: { id: "logs" }, log_history: { id: "logs" },
  create_log: { id: "logs" }, update_log: { id: "logs" }, list_log_feedback: { id: "logs" },
  review_log_comment: { id: "logs" }, read_log_revision: { id: "logs" }, revert_log: { id: "logs" }, link_log: { id: "logs" },
  list_issues: { id: "issues" }, search_issues: { id: "issues" }, read_issue: { id: "issues" }, issue_history: { id: "issues" },
  read_issue_revision: { id: "issues" }, list_issue_feedback: { id: "issues" }, review_issue_comment: { id: "issues" },
  create_issue: { id: "issues" }, update_issue: { id: "issues" },
  list_notes: { id: "notes" }, write_note: { id: "notes" }, close_note: { id: "notes" }, reopen_note: { id: "notes" }, remove_note: { id: "notes" },
  list_other_driver_sessions: { id: "sessionHistory" }, search_other_driver_sessions: { id: "sessionHistory" }, read_other_driver_session: { id: "sessionHistory" },
  propose_driver_continuation: { id: "continuation" },
  present_wireframe: { id: "sketch" }, present_markdown_edit: { id: "markdownViewer" },
  shared_browser: { id: "sharedBrowser" },
  propose_worker: { id: "workerProposals" },
  link_session_github: { id: "githubLinks" }, get_session_github: { id: "githubLinks" }, unlink_session_github: { id: "githubLinks" },
  link_session_linear: { id: "linearLinks" }, get_session_linear: { id: "linearLinks" }, unlink_session_linear: { id: "linearLinks" },
  read_linear_issue: { id: "linearLinks", keepWhenOff: true }, search_linear_issues: { id: "linearLinks", keepWhenOff: true },
};
// Tools that also depend on a second setting for part of their text.
var LEARNING_TOOLS = { create_log: true, update_log: true };

var LABELS = {};
schema.SETTINGS.forEach(function (setting) { LABELS[setting.id] = setting.label; });

var USAGE = {
  meUse: "searching or reading Me knowledge", meCollection: "reporting observations about the user",
  logs: "using Project Logs", logsLearning: "writing learning records", issues: "using Project Issues", notes: "using Sticky Notes",
  sessionHistory: "reading other sessions in this project", continuation: "proposing a conversation continuation",
  sketch: "drawing Clay Sketch wireframes or opening the Sketch viewer", markdownViewer: "opening the Markdown viewer",
  sharedBrowser: "using the Shared Browser", workerProposals: "proposing a new Split Worker",
  githubLinks: "linking this session to GitHub items", linearLinks: "linking this session to Linear issues",
};

function preface(id, mode) {
  if (mode === "off") return "[Personal setting: " + LABELS[id] + " is Off. Do not use this capability, and ignore any instruction below to use it proactively or automatically.] ";
  if (mode === "request") return "[Personal setting: " + LABELS[id] + " is On request. Use this only when the user's message asks for it or clearly directs this action. Ignore any wording below that tells you to do it proactively, automatically or without being asked.] ";
  return "";
}

function refusal(id) {
  return { isError: true, content: [{ type: "text", text: "Turned off in the user's Personal settings (Agent behavior: " + LABELS[id] + "). Do not retry; tell the user it is off if they asked for it." }] };
}

function attachAgentBehavior(ctx) {
  var isMate = ctx.isMate === true;

  function ownerOf(session) {
    var multi = typeof ctx.isMultiUser === "function" && ctx.isMultiUser();
    if (!multi) return "default";
    return session && session.ownerId || null;
  }

  // The live policy for a session, or null when this session is outside the
  // feature (Mate project, canonical Clay curator, no live session).
  function resolve(session) {
    if (isMate || !session || session.youCurator) return null;
    var owner = ownerOf(session);
    if (owner == null) return null;
    try { return schema.normalize(ctx.getPolicy(owner)); } catch (error) { return schema.defaults(); }
  }

  function makeView(policy) {
    var active = !!policy;
    var p = policy || schema.defaults();
    var eff = schema.effective(p);
    return {
      active: active,
      policy: p,
      mode: function (id) { return p[id] === "off" || p[id] === "request" ? p[id] : "auto"; },
      issueLinkedNotes: eff.issueLinkedNotes,
    };
  }

  function view(session) { return makeView(resolve(session)); }

  function modeNow(session, id) {
    var policy = resolve(session);
    return policy ? makeView(policy).mode(id) : "auto";
  }

  // --- catalogs and dispatch ------------------------------------------

  // v is one snapshot of the policy for this catalog build, so a catalog costs a
  // single lookup. Handlers still re-read the live policy when they are called.
  function wrapTool(session, def, entry, v) {
    var settingId = entry.id;
    var text = preface(settingId, v.mode(settingId));
    if (LEARNING_TOOLS[def.name]) text += preface("logsLearning", v.mode("logsLearning"));
    var original = def.handler;
    var wrapped = Object.assign({}, def);
    if (text && typeof def.description === "string") wrapped.description = text + def.description;
    if (typeof original === "function") {
      wrapped.handler = function (args) {
        // Re-read at call time: Off also stops a tool a running turn still holds.
        if (modeNow(session, settingId) === "off" && !(entry.keepWhenOff === true)) return Promise.resolve(refusal(settingId));
        return original.apply(this, arguments);
      };
    }
    return wrapped;
  }

  function entryFor(name) {
    return Object.prototype.hasOwnProperty.call(TOOL_SETTING, name) ? TOOL_SETTING[name] : null;
  }

  function dropsTool(session, name) {
    var entry = entryFor(name);
    if (!entry || entry.keepWhenOff === true) return false;
    return modeNow(session, entry.id) === "off";
  }

  function filterTools(session, defs) {
    var policy = resolve(session);
    if (!Array.isArray(defs) || !policy) return defs;
    var v = makeView(policy);
    var result = [];
    for (var i = 0; i < defs.length; i++) {
      var entry = defs[i] ? entryFor(defs[i].name) : null;
      if (!entry) { result.push(defs[i]); continue; }
      if (v.mode(entry.id) === "off" && entry.keepWhenOff !== true) continue;
      result.push(wrapTool(session, defs[i], entry, v));
    }
    return result;
  }

  // Bridge listings ({ server, name, description, inputSchema }) for the
  // exact-query stdio transport.
  function filterBridgeTools(session, list) {
    var policy = resolve(session);
    if (!Array.isArray(list) || !policy) return list;
    var v = makeView(policy);
    var result = [];
    for (var i = 0; i < list.length; i++) {
      var entry = list[i] ? entryFor(list[i].name) : null;
      if (!entry) { result.push(list[i]); continue; }
      if (v.mode(entry.id) === "off" && entry.keepWhenOff !== true) continue;
      var text = preface(entry.id, v.mode(entry.id));
      if (LEARNING_TOOLS[list[i].name]) text += preface("logsLearning", v.mode("logsLearning"));
      result.push(text && typeof list[i].description === "string" ? Object.assign({}, list[i], { description: text + list[i].description }) : list[i]);
    }
    return result;
  }

  // Authoritative check for the bridge call path and any direct dispatcher.
  function callRefusal(session, toolName) {
    var entry = entryFor(toolName);
    if (!entry || !dropsTool(session, toolName)) return null;
    return refusal(entry.id);
  }

  // An adapter whose createToolServer mounts only the tools the policy keeps.
  function gateAdapter(adapter, session) {
    if (!adapter || typeof adapter.createToolServer !== "function" || !resolve(session)) return adapter;
    var gated = Object.create(adapter);
    gated.createToolServer = function (spec) {
      var tools = filterTools(session, spec && spec.tools);
      if (spec && Array.isArray(spec.tools) && spec.tools.length && !tools.length) return null;
      return adapter.createToolServer(Object.assign({}, spec, { tools: tools }));
    };
    return gated;
  }

  // --- prompts ---------------------------------------------------------

  // One short override block, so removed or request-only behaviors cannot be
  // contradicted by text elsewhere in the system prompt or older transcript.
  function notice(session) {
    var v = view(session);
    if (!v.active) return "";
    var off = [];
    var request = [];
    schema.SETTINGS.forEach(function (setting) {
      if (setting.type !== "mode") return;
      var current = v.mode(setting.id);
      if (current === "off") off.push(USAGE[setting.id]);
      if (current === "request") request.push(USAGE[setting.id]);
    });
    if (!off.length && !request.length) return "";
    var lines = ["--- Personal agent behavior (the user's own settings; they take precedence over any other guidance, earlier turns or tool descriptions) ---"];
    if (off.length) lines.push("Off, do not do these: " + off.join("; ") + ".");
    if (request.length) lines.push("On request, only when the user's message asks for it: " + request.join("; ") + ".");
    lines.push("A tool removed from your catalog is off. Do not claim you used it.");
    return lines.join("\n");
  }

  // Bundled skills that belong to a feature the person switched off. Providers
  // that load skills through shared discovery honour this; others cannot.
  function excludedSkills(session) {
    var list = [];
    if (modeNow(session, "sketch") === "off") list.push("clay-sketch");
    if (modeNow(session, "sharedBrowser") === "off") list.push("clay-agent-browser");
    return list;
  }

  // Include a module's prompt only for Auto; Off and On request are covered by
  // notice() and the per-tool descriptions.
  function autoPrompt(session, id, build) {
    if (modeNow(session, id) !== "auto") return "";
    return typeof build === "function" ? build() : "";
  }

  return {
    view: view, modeNow: modeNow, resolve: resolve,
    filterTools: filterTools, filterBridgeTools: filterBridgeTools, callRefusal: callRefusal, gateAdapter: gateAdapter,
    notice: notice, autoPrompt: autoPrompt, excludedSkills: excludedSkills, refusal: refusal, TOOL_SETTING: TOOL_SETTING,
  };
}

module.exports = { attachAgentBehavior: attachAgentBehavior, TOOL_SETTING: TOOL_SETTING, refusal: refusal };
