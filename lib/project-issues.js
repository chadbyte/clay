var mcp = require("./issues-mcp-server");
var resolveIssueWorkSession = require("./issue-work-session").resolveIssueWorkSession;
function attachProjectIssues(ctx) {
  function user(ws) {
    return !ctx.isMate && ctx.service && ctx.service.bindUser({ projectSlug: ctx.projectSlug, userId: ws._clayUser && ws._clayUser.id });
  }
  function notify(entry, type) {
    for (var ws of ctx.getClients()) {
      if (!ws || ws.readyState !== 1 || ws._clayPane) continue;
      try { var bound = user(ws); if (bound) { if (entry.deleted) bound.readIssueTombstone({ ref: entry.ref }); else bound.readIssue({ ref: entry.ref }); ctx.sendTo(ws, Object.assign({ type: type || "issue_updated", projectSlug: ctx.projectSlug, ref: entry.ref, status: entry.status, title: entry.title, revision: entry.revision }, type === "issue_deleted" ? { deleted: true } : {})); } } catch (error) { /* Access may have changed. */ }
    }
    return entry;
  }
  function sessionBound(session) {
    var bound = !ctx.isMate && ctx.service && session && ctx.service.bindProjectSession({ projectSlug: ctx.projectSlug, session: session });
    if (!bound) return null;
    ["createIssue", "updateIssue", "reviewIssueComment"].forEach(function (method) {
      var original = bound[method];
      bound[method] = async function (args) { var result = await original(args); if (method === "reviewIssueComment") return notify(result, "issue_commented"); return notify(result); };
    });
    return bound;
  }
  function defs(session) { return ctx.isMate || !ctx.service || (session && !sessionBound(session)) ? [] : mcp.getToolDefs(sessionBound(session)); }
  function handleMessage(ws, msg) {
    var methods = { issues_list: "listIssues", issue_read: "readIssue", issue_create: "createIssue", issue_update: "updateIssue", issue_history: "issueHistory", issue_revision: "readIssueRevision", issue_comment: "commentIssue", issue_delete: "removeIssue" };
    if (!methods[msg.type] && msg.type !== "issue_start_work" && msg.type !== "issue_open_work") return false;
    Promise.resolve().then(async function () {
      var bound = user(ws);
      if (!bound) throw new Error("Issues are unavailable for this project.");
      var result;
      if (msg.type === "issue_open_work") {
        var session = resolveIssueWorkSession(bound, msg.args || {});
        ctx.sm.switchSession(session.localId, ws); ws._clayActiveSession = session.localId;
        result = { sessionId: session.localId };
      } else if (msg.type === "issue_start_work") { result = await ctx.startWork(ws, msg, bound); notify(bound.readIssue({ ref: msg.args.ref })); }
      else {
        result = await bound[methods[msg.type]](msg.args || {});
        if (msg.type === "issue_create" || msg.type === "issue_update") notify(result);
        else if (msg.type === "issue_comment") notify(result, "issue_commented");
        else if (msg.type === "issue_delete") notify(result, "issue_deleted");
      }
      if (msg.type === "issue_read" && result) {
        result = Object.assign({}, result, { githubLinks: [] });
        (result.linkedWorkSessions || []).forEach(function (link) {
          try {
            var work = bound.resolveWorkSession({ ref: result.ref, sessionOriginId: link.sessionId });
            (work.githubLinks || []).forEach(function (item) {
              if (!result.githubLinks.some(function (existing) { return existing.url === item.url; })) result.githubLinks.push(item);
            });
          } catch (error) { /* Linked work may no longer be visible. */ }
        });
      }
      ctx.sendTo(ws, { type: "issues_result", requestId: msg.requestId, action: msg.type, result: result, canDelete: bound.canDelete === true });
    }).catch(function (error) {
      var result = error && error.sessionId ? { sessionId: error.sessionId } : undefined;
      ctx.sendTo(ws, { type: "issues_result", requestId: msg.requestId, action: msg.type, error: error.message, result: result });
    });
    return true;
  }
  return {
    handleMessage: handleMessage, notify: notify,
    getDynamicToolDefs: function (session) { return defs(session).map(function (tool) { tool.permissionName = "mcp__clay-issues__" + tool.name; return tool; }); },
    createMcpServer: function (adapter, session) { return ctx.isMate || !ctx.service || !adapter.createToolServer ? null : adapter.createToolServer({ name: "clay-issues", version: "1.0.0", tools: defs(session) }); },
    getBridgeTools: function (session, normalize) { return defs(session).map(function (tool) { return { server: "clay-issues", name: tool.name, description: tool.description, inputSchema: normalize(tool.inputSchema) }; }); },
    callBridgeTool: function (session, name, args) { var tool = defs(session).find(function (item) { return item.name === name; }); if (!tool || !session) return Promise.reject(new Error("Issue tool unavailable.")); return tool.handler(args); },
    getSystemPrompt: function (session) { return sessionBound(session) ? "--- Project Issues ---\n" + mcp.CONTRACT : ""; },
  };
}
module.exports = { attachProjectIssues: attachProjectIssues };
