var github = require("./session-github");
var buildShape = require("./session-spawn-mcp-server").buildShape;
var CONTRACT = "GitHub work links: when an issue is clearly the task this session is implementing, or you create/work on its PR, call link_session_github with its exact GitHub URL. Mere mentions, examples, and reference material must not be linked. Do not infer a session's PR from the repository's current branch: sessions may share a checkout. This records local metadata only and does not post to GitHub. Use get_session_github to inspect/refresh linked status and discover accessible sessions already working on the same reference before starting duplicate work. Keep Issues as quiet background records, not a mandatory workflow. Unlink an incorrect association with unlink_session_github.";
function attachSessionGithub(ctx) {
  var inflight = new Map();
  var attempts = new Map();
  function authorize(session) {
    if (!session || ctx.sm.sessions.get(session.localId) !== session || ctx.isMate || !ctx.canUse(session)) throw new Error("GitHub links require an authorized project session.");
    var identity = ctx.identity(session);
    // Account login does not imply OS isolation. Match the project's execution mode.
    if (ctx.osUsers && !identity) throw new Error("GitHub requires a mapped OS user with gh authentication in OS-isolated mode.");
    return identity;
  }
  function persist(session) {
    if (ctx.sm.saveSessionFile(session) === false) throw new Error("Could not save GitHub links.");
    ctx.sm.broadcastSessionList();
  }
  async function refresh(session, force) {
    var identity = authorize(session);
    var id = session.localId;
    if (inflight.has(id)) return inflight.get(id);
    if (!force && Date.now() - (attempts.get(id) || 0) < 60000) return session.githubLinks || [];
    attempts.set(id, Date.now());
    var pending = (async function () {
      var links = (session.githubLinks || []).slice();
      var updated = [];
      for (var link of links) {
        try { updated.push(await github.readReference(ctx.cwd, link.url, identity, ctx.run)); }
        catch (error) { updated.push(Object.assign({}, link, { stale: true })); }
      }
      authorize(session);
      // A link/unlink during the request wins over the refresh snapshot.
      session.githubLinks = (session.githubLinks || []).map(function (link) {
        var index = links.indexOf(link);
        return index < 0 ? link : updated[index];
      });
      if (links.length) persist(session);
      return session.githubLinks || [];
    })();
    inflight.set(id, pending);
    try { return await pending; } finally { inflight.delete(id); }
  }
  async function invoke(session, name, args) {
    var identity = authorize(session);
    if (name === "get_session_github") {
      var links = await refresh(session, false);
      var matches = [];
      if (args.url) {
        var url = github.parseReference(args.url).url.toLowerCase();
        ctx.sm.sessions.forEach(function (other) {
          if (!other.hidden && !other.delegated && !require("./session-provenance").isWorker(other) && ctx.canRead(session, other) && (other.githubLinks || []).some(function (link) { return link.url.toLowerCase() === url; })) matches.push({ sessionId: other.localId, title: other.title });
        });
      }
      return { links: links, matchingSessions: matches.slice(0, 20) };
    }
    var ref = github.parseReference(args.url);
    if (name === "unlink_session_github") {
      session.githubLinks = (session.githubLinks || []).filter(function (link) { return link.url.toLowerCase() !== ref.url.toLowerCase(); });
    } else {
      var verified = await github.readReference(ctx.cwd, ref.url, identity, ctx.run);
      authorize(session);
      var retained = (session.githubLinks || []).filter(function (link) { return link.url.toLowerCase() !== ref.url.toLowerCase(); });
      if (retained.length >= 8) throw new Error("A session can link up to eight GitHub items.");
      session.githubLinks = retained.concat([verified]);
    }
    persist(session);
    return { links: session.githubLinks };
  }
  function defs(session) {
    if (ctx.isMate || (session && !ctx.canUse(session))) return [];
    return ["link_session_github", "get_session_github", "unlink_session_github"].map(function (name) {
      return { name: name, permissionName: "mcp__clay-github__" + name, description: CONTRACT + " " + (name === "get_session_github" ? "Read linked status; optional URL finds visible existing work sessions." : name === "link_session_github" ? "Verify and attach one issue or PR to the current session." : "Remove one local association without modifying GitHub."), inputSchema: buildShape({ url: { type: "string", description: "Exact https://github.com/owner/repo/issues/123 or /pull/123 URL." } }, name === "get_session_github" ? [] : ["url"]), handler: async function (args) {
        try { return { content: [{ type: "text", text: JSON.stringify(await invoke(session, name, args || {})) }] }; }
        catch (error) { return { isError: true, content: [{ type: "text", text: error.message }] }; }
      } };
    });
  }
  return {
    getDynamicToolDefs: defs,
    getSystemPrompt: function () { return ctx.isMate ? "" : CONTRACT; },
    createMcpServer: function (adapter, session) { return ctx.isMate || !adapter.createToolServer ? null : adapter.createToolServer({ name: "clay-github", version: "1.0.0", tools: defs(session) }); },
    getBridgeTools: function (session, normalize) { return defs(session).map(function (tool) { return { server: "clay-github", name: tool.name, description: tool.description, inputSchema: normalize(tool.inputSchema) }; }); },
    callBridgeTool: function (session, name, args) { var tool = defs(session).find(function (item) { return item.name === name; }); return tool ? tool.handler(args) : Promise.reject(new Error("GitHub tool unavailable.")); },
    handleMessage: function (ws, msg) {
      if (msg.type !== "session_github_refresh") return false;
      var session = ctx.sm.sessions.get(ws._clayActiveSession);
      if (!session || !ctx.canRefresh(ws, session) || !(session.githubLinks || []).length) return true;
      refresh(session, false).catch(function () {});
      return true;
    },
  };
}
module.exports = { attachSessionGithub: attachSessionGithub };
