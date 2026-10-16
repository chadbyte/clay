// Restricted contextual access. References originate on authenticated app sockets;
// model arguments and submitted attachments never create or widen a grant.
var crypto = require('crypto');
var refs = require('./workspace-query-service');
var provenance = require('./session-provenance');
var personal = require('./mcp-session-access');
var z = require('zod');
var preparationSchema = z.object({ type: z.literal('mate_context_prepare'), requestId: z.string().max(100).optional(), available: z.boolean(), mateId: z.string().max(128).optional(), sessionId: z.number().int().positive().optional() }).strict();
function attachMateContextService(ctx) {
  var access = require('./workspace-query-access').attachWorkspaceQueryAccess(ctx);
  var views = new WeakMap(), pending = new Map(), active = new WeakMap();
  function owner(ws) { return ctx.isMultiUser() ? ws && ws._clayUser && ws._clayUser.id : null; }
  function privateSession(session, manager, id) {
    if (!session || manager.sessions.get(session.localId) !== session || session.hidden || session.destroying || session.spawn || provenance.isWorker(session) ||
      session.sessionVisibility === 'shared' || session.delegated || session._delegatedBy || session._pairDelegation || session._mcpForeignInput ||
      session.homeDebatePlanning || session.debateSetupMode || session.mateCreationMode || session._mentionInProgress) throw new Error('A live private owner conversation is required.');
    if (ctx.isMultiUser() ? !id || session.ownerId !== id || !ctx.findUser(id) || !personal.canUsePersonalConnections(session, manager.sessions) : !!session.ownerId ||
      (session.history || []).some(function (entry) { return entry.type === 'user_message' && entry.from && entry.from !== 'default'; })) throw new Error('Owner-authored input is required.');
  }
  function source(id, mateId, sessionId) {
    var mate = ctx.resolveMate(id, mateId), project = ctx.getProjects().get('mate-' + mateId);
    var status = project && project.getStatus(), manager = project && project.getSessionManager();
    if (!mate || mate.builtinKey === 'clay' || mate.archived || mate.lifecycleDeletion || !status || !status.isMate || status.mateId !== mateId || (ctx.isMultiUser() && (mate.createdBy !== id || status.projectOwnerId !== id))) throw new Error('This private Mate is unavailable.');
    var session = manager.sessions.get(sessionId);
    privateSession(session, manager, id);
    var user = ctx.isMultiUser() && ctx.findUser(id);
    return { mate: mate, revision: JSON.stringify(mate), project: project, session: session, manager: manager, path: status.path, osIdentity: JSON.stringify(user && [user.id, user.linuxUser || null]) };
  }
  function selected(id, viewer) {
    var project = ctx.getProjects().get(viewer.slug), status = project && project.getStatus();
    var principal = { userId: id, singleUserOwnerId: id };
    if (!status || status.isMate || !access.evaluate(principal, status).accessible) throw new Error('The selected ordinary project is unavailable.');
    var manager = project.getSessionManager(), session = manager.sessions.get(viewer.sessionId);
    privateSession(session, manager, id);
    return { project: project, session: session, path: status.path, revision: JSON.stringify([status.path, status.projectOwnerId, session.sessionOriginId, session.cliSessionId, session.title, session.history]),
      summary: { project: String(status.title || status.project || status.slug).slice(0, 160), conversation: String(session.title || 'New conversation').slice(0, 160) } };
  }
  function validate(entry) {
    if (!entry || Date.now() - entry.created > 300000) throw new Error('Context expired. Send a new message from the current view.');
    var viewer = ctx.getOwnerUi().check(entry.owner, entry.viewer);
    if (views.get(viewer.ws) !== entry.view) throw new Error('The current view changed. Send a new message from that view.');
    var live = source(entry.owner, entry.mateId, entry.source.session.localId), target = selected(entry.owner, viewer);
    if (live.project !== entry.source.project || live.session !== entry.source.session || live.revision !== entry.source.revision || live.path !== entry.source.path || live.osIdentity !== entry.source.osIdentity) throw new Error('The Mate was changed or replaced.');
    if (target.project !== entry.target.project || target.session !== entry.target.session || target.revision !== entry.target.revision) throw new Error('The selected conversation changed or was replaced.');
    return { source: live, target: target };
  }
  function send(ws, value) { if (ws.readyState === 1) ws.send(JSON.stringify(value)); }
  function handleMessage(ws, msg) {
    if (msg.type !== 'mate_context_prepare') return false;
    var id = owner(ws), requestId = typeof msg.requestId === 'string' ? msg.requestId.slice(0, 100) : null;
    try {
      preparationSchema.parse(msg);
      var viewer = ctx.getOwnerUi().list(id).find(function (item) { return item.ws === ws && item.supported; });
      if (!viewer) throw new Error('The originating window is unavailable.');
      var view = {}; views.set(ws, view);
      if (msg.available !== true) throw new Error('This view has no supported conversation selection.');
      var live = source(id, msg.mateId, msg.sessionId), target = selected(id, viewer);
      pending.forEach(function (entry, key) { if (Date.now() - entry.created > 300000 || entry.viewer.ws === ws) pending.delete(key); });
      if (pending.size >= 100) throw new Error('Context capacity is temporarily full.');
      var ref = 'mate-context:' + crypto.randomUUID();
      pending.set(ref, { owner: id, viewer: viewer, view: view, mateId: msg.mateId, source: live, target: target, created: Date.now() });
      send(ws, { type: 'mate_context_prepared', requestId: requestId, contextRef: ref, summary: target.summary, expiresAt: Date.now() + 300000 });
    } catch (error) { send(ws, { type: 'mate_context_prepared', requestId: requestId, contextRef: null, error: error.message }); }
    return true;
  }
  function activate(ws, session, ref, message) {
    active.delete(session);
    var original = pending.get(ref);
    var entry = original && Object.assign({}, original);
    if (!entry) throw new Error('No current context was shared.');
    var live = validate(entry);
    if (owner(ws) !== entry.owner || live.source.session !== session || !live.source.project.clients.has(ws) || ws._clayActiveSession !== session.localId || ws._clayAuthCheck && !ws._clayAuthCheck()) throw new Error('Context belongs to another authenticated conversation.');
    entry.message = message; entry.ref = ref; entry.requests = new Map(); entry.deliveries = new Set(); active.set(session, entry);
    return { contextRef: ref, summary: entry.target.summary, limits: 'Selected conversation metadata; read_selected_context returns at most 20 redacted text turns (24000 characters). No screen capture, Issues, documents, files or hidden settings. Opening this conversation requires exact owner review.' };
  }
  function clear(session) { active.delete(session); }
  function assertActive(session, ref) {
    var entry = active.get(session);
    var latest = (session.history || []).filter(function (item) { return item.type === 'user_message'; }).slice(-1)[0];
    if (!entry || latest !== entry.message || entry.ref !== ref || session.taskStopRequested || session.abortController && session.abortController.signal.aborted) throw new Error('Shared context was interrupted.');
    validate(entry);
  }
  function bind(input) {
    var session = input.session, generation = Number(session._sdkQueryGeneration || 0), entry = active.get(session), original;
    try { original = source(ctx.isMultiUser() ? input.projectOwnerId : null, input.mateId, session.localId); }
    catch (error) { return null; }
    if (original.session !== session || input.projectSlug !== 'mate-' + input.mateId || session.taskStopRequested || session.abortController && session.abortController.signal.aborted) return null;
    function base() {
      var live = source(ctx.isMultiUser() ? input.projectOwnerId : null, input.mateId, session.localId);
      if (live.session !== session || live.project !== original.project || live.revision !== original.revision || live.path !== original.path || live.osIdentity !== original.osIdentity || Number(session._sdkQueryGeneration || 0) !== generation || session.taskStopRequested || session.abortController && session.abortController.signal.aborted) throw new Error('This exact private Mate query is unavailable.');
    }
    function check() {
      base();
      if (!entry || active.get(session) !== entry || Number(session._sdkQueryGeneration || 0) !== generation || session.taskStopRequested || session._pendingMessageDrainPaused || session.abortController && session.abortController.signal.aborted) throw new Error('This context query is unavailable or stopped.');
      var latest = (session.history || []).filter(function (item) { return item.type === 'user_message'; }).slice(-1)[0];
      if (latest !== entry.message || input.mateId !== entry.mateId || input.projectSlug !== 'mate-' + entry.mateId || (ctx.isMultiUser() && input.projectOwnerId !== entry.owner)) throw new Error('Context belongs to another exact owner query.');
      return validate(entry);
    }
    function reference(args) { if (!args || args.contextRef !== (entry && entry.ref)) throw new Error('Use only the context reference returned for this query.'); return check(); }
    return {
      current: function () {
        base();
        if (!entry) return { status: 'unavailable', supported: ['selected_conversation'], unavailable: ['issues', 'documents', 'tabs', 'screen_capture'] };
        check(); return { status: 'shared_snapshot', contextRef: entry.ref, summary: entry.target.summary, expiresAt: entry.created + 300000, supported: ['selected_conversation'], unavailable: ['issues', 'documents', 'tabs', 'screen_capture'], untrusted: true };
      },
      read: async function (args) {
        var live = reference(args), bound = ctx.workspace.bindProjectSession({ projectSlug: entry.viewer.slug, session: live.target.session, viewerId: entry.owner });
        if (!bound) throw new Error('The selected conversation is unavailable.');
        var result = await bound.readProjectSession({ projectSlug: entry.viewer.slug, sessionRef: refs.sessionRef(entry.viewer.slug, live.target.session), limit: 20 });
        reference(args);
        var remaining = 24000;
        var turns = result.turns.map(function (turn) { var text = turn.text.slice(0, remaining); remaining -= text.length; return { role: turn.role, text: text }; }).filter(function (turn) { return !!turn.text; });
        return { summary: entry.target.summary, turns: turns, truncated: result.total > turns.length || remaining === 0, untrusted: true };
      },
      navigate: function (args) {
        reference(args);
        var key = JSON.stringify([args.contextRef, args.why]), old = entry.requests.get(args.requestId);
        if (old) { if (old.key !== key) throw new Error('This requestId already names another intent.'); return old.promise; }
        if (entry.requests.size >= 20) throw new Error('Too many navigation requests in this context.');
        var promise = Promise.resolve().then(async function () {
          var live = check();
          var answer = await live.source.project.requestProductControlReview(session,
            'Open the selected conversation: ' + entry.target.summary.conversation + '\nProject: ' + entry.target.summary.project + '\nWhy: ' + args.why,
            check, { kind: 'product-control', action: 'Open conversation', target: entry.target.summary.conversation, context: 'In ' + entry.target.summary.project + ', in the window that shared this context.', reason: args.why });
          check();
          if (answer.status !== 'submitted' || !answer.answers.control || answer.answers.control.length !== 1 || answer.answers.control[0] !== 'Apply exact change') return { status: 'cancelled' };
          var result = ctx.getOwnerUi().deliver(entry.owner, entry.viewer, { projectSlug: entry.viewer.slug, sessionId: entry.target.session.localId, sessionOriginId: entry.target.session.sessionOriginId, contextualSourceMateId: entry.mateId }, check);
          if (result.deliveryId) entry.deliveries.add(result.deliveryId);
          return result;
        }).catch(function (error) { return { status: 'failed', retrySafe: false, error: error.message }; });
        entry.requests.set(args.requestId, { key: key, promise: promise }); return promise;
      },
      receipt: function (args) { reference(args); if (!entry.deliveries.has(args.deliveryId)) throw new Error('Receipt belongs to another context.'); return ctx.getOwnerUi().read(entry.owner, args.deliveryId); }
    };
  }
  return { handleMessage: handleMessage, activate: activate, clear: clear, assertActive: assertActive, bind: bind };
}
module.exports = { attachMateContextService: attachMateContextService };
