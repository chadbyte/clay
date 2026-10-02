var github = require("./session-github");
var buildShape = require("./session-spawn-mcp-server").buildShape;
var CONTRACT = "GitHub work links: proactively call link_session_github as soon as conversation context or tool results reasonably establish that an issue or PR is part of this session's work. Do not wait for an explicit linking request, implementation to begin, or work to finish. Investigating an issue, reviewing a PR or its requested changes, addressing review feedback, and checking CI or merge readiness all count as work. When a working PR is connected to an issue and both are relevant to the task, link both. Resolve a known repository and issue/PR number to the exact GitHub URL; if the repository is uncertain, verify it with a read-only lookup instead of silently skipping the link. Incidental mentions, examples, and unrelated reference material alone do not qualify. The current branch alone is insufficient evidence because sessions may share a checkout; combine it with conversation or verified task evidence. This records local metadata only and does not post to GitHub, so no separate linking approval is needed. Use get_session_github to inspect/refresh linked status and discover accessible sessions already working on the same reference before starting duplicate work. When the work shifts to another issue or PR, check that the relevant links are present before reporting progress or completion. Keep Issues as quiet background records, not a mandatory workflow. Unlink an incorrect association with unlink_session_github.";
function attachSessionGithub(ctx) {
  var inflight = new Map();
  var attempts = new Map();
  var statusCache = new Map();
  var statusQueue = Promise.resolve();
  function readStatus(session, link, stillAllowed) {
    var identity = authorize(session);
    var key = JSON.stringify([session.ownerId || null, identity && identity.uid, identity && identity.home, link.url.toLowerCase()]);
    var cached = statusCache.get(key);
    if (cached && (cached.pending || cached.until > Date.now())) return cached.pending || (cached.error ? Promise.reject(cached.error) : Promise.resolve(cached.value));
    var entry = { failures: cached ? cached.failures : 0 };
    statusCache.set(key, entry);
    entry.pending = statusQueue.then(async function () {
      try {
        var currentIdentity = authorize(session);
        if (JSON.stringify(currentIdentity) !== JSON.stringify(identity) || (stillAllowed && !stillAllowed())) throw new Error("Session access changed.");
        entry.value = await github.readReference(ctx.cwd, link.url, identity, ctx.run, true);
        entry.failures = 0;
        entry.until = Date.now() + (entry.value.state === "closed" || entry.value.state === "merged" ? 300000 : 45000);
        return entry.value;
      } catch (error) {
        entry.error = error;
        entry.failures++;
        entry.until = Date.now() + Math.min(900000, 60000 * Math.pow(2, entry.failures - 1));
        throw error;
      } finally {
        entry.pending = null;
        if (statusCache.size > 1000) {
          for (var pair of statusCache) {
            if (!pair[1].pending && pair[1].until <= Date.now()) statusCache.delete(pair[0]);
          }
        }
      }
    });
    statusQueue = entry.pending.catch(function () {});
    return entry.pending;
  }
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
  async function refresh(session, force, statusOnly, stillAllowed) {
    var identity = authorize(session);
    var id = session.localId + (statusOnly ? ":status" : ":full");
    if (inflight.has(id)) return inflight.get(id);
    if (!force && Date.now() - (attempts.get(id) || 0) < (statusOnly ? 30000 : 60000)) return session.githubLinks || [];
    attempts.set(id, Date.now());
    var pending = (async function () {
      var links = (session.githubLinks || []).slice();
      var updated = [];
      for (var link of links) {
        try {
          if (stillAllowed && !stillAllowed()) throw new Error("Session access changed.");
          updated.push(statusOnly ? Object.assign({}, link, await readStatus(session, link, stillAllowed), { stale: false }) : await github.readReference(ctx.cwd, link.url, identity, ctx.run));
        }
        catch (error) { updated.push(Object.assign({}, link, { stale: true })); }
      }
      authorize(session);
      if (stillAllowed && !stillAllowed()) throw new Error("Session access changed.");
      var changed = false;
      // A link/unlink during the request wins over the refresh snapshot.
      session.githubLinks = (session.githubLinks || []).map(function (link) {
        var index = links.indexOf(link);
        if (index < 0) return link;
        var next = updated[index];
        var before = Object.assign({}, link, { checkedAt: null, stale: !!link.stale });
        var after = Object.assign({}, next, { checkedAt: null, stale: !!next.stale });
        if (JSON.stringify(before) !== JSON.stringify(after)) changed = true;
        return next;
      });
      if (changed) persist(session);
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
      var ids = Array.isArray(msg.sessionIds) ? msg.sessionIds.slice(0, 100) : [ws._clayActiveSession];
      Array.from(new Set(ids)).forEach(function (id) {
        var session = ctx.sm.sessions.get(id);
        if (!session || !ctx.canRefresh(ws, session) || !(session.githubLinks || []).length) return;
        refresh(session, false, true, function () { return ctx.canRefresh(ws, session); }).catch(function () {});
      });
      return true;
    },
  };
}
module.exports = { attachSessionGithub: attachSessionGithub };
