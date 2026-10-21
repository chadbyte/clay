var workspaceInput = require('./clay-view-workspace-input');
var crypto = require('crypto'), fs = require('fs');
var layout = require('./split-view-layout');
var schema = require('./clay-split-view-input').operationSchema;
function attachSplitViewControls(ctx) {
  function live(op) {
    var principal = ctx.authorize(), project = ctx.getProjects().get(op.projectSlug), status = project && project.getStatus();
    if (!status || status.isMate) throw new Error('Select an existing ordinary project.');
    ctx.authorizeProject(principal, status);
    var viewer = ctx.service().inspect(principal.userId, op.viewerRef);
    if (!viewer.supported || viewer.slug !== op.projectSlug) throw new Error('Select an authenticated owner window already connected to this project.');
    var api = project.getSplitViewControl && project.getSplitViewControl(viewer.ws);
    if (!api) throw new Error('Split view controls are unavailable for this connection.');
    var saved = api.state();
    if (!saved || saved.error || saved.ok === false) throw new Error(saved && saved.error || 'Split view state is unavailable.');
    var sessions = project.getSessionManager().sessions;
    function exact(origin) {
      var matches = Array.from(sessions.values()).filter(function (item) { return item.sessionOriginId === origin; });
      var session = matches.length === 1 && matches[0];
      if (!session || session.hidden || session.destroying || session.spawn || require('./session-provenance').isWorker(session) || (session.ownerId || null) !== (principal.userId || null)) throw new Error('An exact owned presentation member is unavailable.');
      return session;
    }
    saved.views.forEach(function (view) { view.sessions.forEach(function (item) { exact(item.sessionOriginId); }); });
    var origins = op.sessionOrigins || op.targetSessionOrigins || [];
    var members = origins.map(exact);
    var view = saved.views.find(function (item) { return item.id === (op.id || op.sourceViewId); });
    if (op.change) {
      if (op.accountId !== principal.userId) throw new Error('Exact account identity changed.');
      if (JSON.stringify(op).length > workspaceInput.MAX_OPERATION_BYTES) throw new Error('Bounded View composition is too large.');
      workspaceInput.validateOperation(op, saved, view);
      if (saved.revision !== op.expectedRevision) throw new Error('Saved view collection revision changed.');
      if (op.change !== 'create' && (!view || view.revision !== op.expectedViewRevision)) throw new Error('Exact Split view revision changed.');
      if ((op.change === 'open' || op.change === 'focus') && op.focusOrigin && !view.sessions.some(function (item) { return item.sessionOriginId === op.focusOrigin; })) throw new Error('Focus must belong to the exact view.');
      if (['create', 'update', 'move'].indexOf(op.change) >= 0 && (new Set(origins).size !== origins.length || !layout.validateTree(op.tree, origins).ok)) throw new Error('Layout must contain exactly zero to eight unique members.');
    }
    var directory = fs.statSync(status.path);
    return { project: project, root: JSON.stringify([status.path, fs.realpathSync(status.path), directory.dev, directory.ino]), principal: principal, viewer: viewer, api: api, saved: saved, view: view,
      identity: JSON.stringify(saved.owner), members: members.concat(view ? view.sessions.map(function (item) { return exact(item.sessionOriginId); }) : []) };
  }
  function check(entry, afterNavigation) {
    if (Date.now() - entry.created > 300000) throw new Error('Split view inspection expired.');
    var current = live(entry.op), initial = entry.snapshot;
    if (current.project !== initial.project || current.root !== initial.root || current.identity !== initial.identity || current.members.length !== initial.members.length || current.members.some(function (item, i) { return item !== initial.members[i]; })) throw new Error('Split view project, OS identity or members changed.');
    if (!afterNavigation) ctx.service().check(current.principal.userId, initial.viewer);
    return current;
  }
  async function read(args) {
    var current = live(args);
    var identities = current.saved.views.flatMap(function (view) { return view.sessions.map(function (item) { return current.project.getSessionManager().sessions.get(item.id); }); });
    var workerReads = new Map();
    var active = current.project.getSessionManager().sessions.get(current.viewer.sessionId);
    identities.concat(active || []).forEach(function (session) {
      if (!session || require('./session-provenance').isWorker(session) || workerReads.has(session.sessionOriginId)) return;
      workerReads.set(session.sessionOriginId, current.project.getViewWorkerSupervision(current.viewer.ws, session.sessionOriginId));
    });
    function validateRead(next) {
      ctx.service().check(next.principal.userId, current.viewer);
      if (next.project !== current.project || next.root !== current.root || next.identity !== current.identity || identities.some(function (session) {
        return !session || next.project.getSessionManager().sessions.get(session.localId) !== session || (session.ownerId || null) !== (next.principal.userId || null);
      }) || next.saved.revision !== current.saved.revision) throw new Error('Project or exact view member identity changed.');
      workerReads.forEach(function (reader) { reader.revalidate(); });
    }
    var observed = await ctx.service().observeView(current.principal.userId, current.viewer, function () {
      validateRead(live(args));
    });
    var latest = live(args); validateRead(latest); workspaceInput.validateObservation(latest.saved, observed);
    var awareness = require('./clay-split-view-awareness').describe(latest, observed, args.projectSlug, workerReads);
    return { projectSlug: args.projectSlug, accountId: latest.principal.userId, workspaceVersion: 1, maxToolPanes: 8, reviewLimits: { operationCharacters: workspaceInput.MAX_OPERATION_BYTES, questionCharacters: 2000 }, revision: latest.saved.revision, views: awareness.views, currentView: awareness.currentView, runtimeObservedAt: awareness.runtimeObservedAt, folders: latest.api.folders(),
      ownerWindow: { viewerRef: args.viewerRef, connection: 'connected', observedAt: Date.now(), evidence: 'Exact authenticated server socket; independent of provider runtime and pane readiness.' },
      screen: observed, maxMembers: 8, presets: layout.PRESETS, untrusted: true,
      unsupported: { linkedWorkerPresentation: 'Canonical composition may retain linked Worker layout but cannot open, close or retarget the pair; use human Worker controls. Render proof for navigation with visible linked Worker frames remains unavailable.', newToolResource: 'View composition cannot create or rebind file, Terminal or Browser resources. Use a separately authorized typed resource action, then the human View controls.', workbenchMode: 'Account-wide User Settings preference, excluded from canonical controls.', workerExecution: 'Use reviewed project Driver assignment.', offlineWindow: 'Select a live owner window connected to the project.' } };
  }
  async function inspect(args) {
    if (JSON.stringify(args.operation).length > workspaceInput.MAX_OPERATION_BYTES) throw new Error('Bounded View composition is too large.');
    var op = schema.parse(args.operation), current = live(op);
    var observed = await ctx.service().observeView(current.principal.userId, current.viewer, function () { live(op); });
    if (observed.status !== 'observed' || observed.snapshot.hidden) throw new Error('The selected window did not provide a visible stable screen observation.' + (observed.error ? ' ' + observed.error : ''));
    workspaceInput.validateObservation(current.saved, observed);
    if ((op.workspace || op.targetWorkspace || current.view && (current.view.sessions.length < 2 || current.view.workspace && current.view.workspace.panes.some(function (pane) { return pane.kind !== 'session'; }))) && !Array.isArray(observed.snapshot.tools)) throw new Error('The selected client does not support workspace observations.');
    var entry = { slug: op.projectSlug, op: op, snapshot: current, screen: observed.snapshot, created: Date.now() };
    check(entry);
    if (op.change === 'focus' && entry.screen.viewId !== op.id) throw new Error('Focus requires that exact view already open in the selected window.');
    entry.presentationValid = function () { check(entry); };
    var token = 'split-view-control:' + crypto.randomUUID();
    if (ctx.state.targets.size >= 100) ctx.state.targets.delete(ctx.state.targets.keys().next().value);
    ctx.state.targets.set(token, entry);
    return { targetToken: token, operation: op, savedView: current.view || null, selectedScreen: entry.screen, expiresInSeconds: 300 };
  }
  function act(args, entry) {
    ctx.authorize();
    var key = JSON.stringify([args.targetToken, args.why]), old = ctx.state.requests.get(args.requestId);
    if (old) {
      if (old.key !== key) throw new Error('requestId names another exact intent.');
      if (Date.now() - old.created > 300000) throw new Error('Five-minute receipt expired. Inspect before any new reviewed action.');
      // A completed receipt is historical; never replay a persisted mutation.
      var principal = ctx.authorize(), project = ctx.getProjects().get(entry.op.projectSlug);
      if (project !== entry.snapshot.project || JSON.stringify([project.getStatus().path, fs.realpathSync(project.getStatus().path), fs.statSync(project.getStatus().path).dev, fs.statSync(project.getStatus().path).ino]) !== entry.snapshot.root) throw new Error('Target project was replaced.');
      ctx.authorizeProject(principal, project.getStatus());
      var viewer = ctx.service().inspect(principal.userId, entry.op.viewerRef);
      var api = project.getSplitViewControl(viewer.ws), saved = api && api.state();
      if (!saved || saved.error || JSON.stringify(saved.owner) !== entry.snapshot.identity || entry.snapshot.members.some(function (item) { return project.getSessionManager().sessions.get(item.localId) !== item || (item.ownerId || null) !== (principal.userId || null); })) throw new Error('Target owner, OS identity or members changed.');
      return old.promise;
    }
    if (ctx.state.requests.size >= 100) throw new Error('Too many screen requests in this query.');
    var promise = Promise.resolve().then(async function () {
      check(entry);
      var question = 'Change Split view: ' + entry.op.change + '\n' + workspaceInput.reviewText(entry.op, entry.op.targetViewId ? entry.snapshot.saved.views.find(function (view) { return view.id === entry.op.targetViewId; }) : entry.snapshot.view) + '\nWhy: ' + args.why;
      if (question.length > 2000) throw new Error('Exact view change must fit the owner review.');
      var answer = await ctx.review(question, function () { check(entry); }, { kind: 'product-control', action: 'Change Split view', target: entry.snapshot.view ? entry.snapshot.view.name : 'New Split view', context: 'Selected window in ' + entry.op.projectSlug, reason: args.why });
      if (answer.status !== 'submitted' || !answer.answers.control || answer.answers.control.length !== 1 || answer.answers.control[0] !== 'Apply exact change') return { status: 'cancelled', persisted: false };
      var current = check(entry);
      var observed = await ctx.service().observeView(current.principal.userId, current.viewer, function () { check(entry); });
      current = check(entry);
      workspaceInput.validateObservation(current.saved, observed);
      if (observed.status !== 'observed' || JSON.stringify(observed.snapshot) !== JSON.stringify(entry.screen)) throw new Error('Selected screen changed during review. Inspect again.');
      if (entry.op.change === 'open' || entry.op.change === 'focus') {
        var target = { surface: 'split_view', projectSlug: entry.op.projectSlug, view: current.view, focusOrigin: entry.op.focusOrigin, expectedScreen: entry.screen };
        return ctx.service().deliver(current.principal.userId, current.viewer, target, function () { check(entry, true); }, ctx.activity && ctx.activity());
      }
      var result = current.api[entry.op.change](Object.assign({}, entry.op));
      if (!result.ok) return { status: 'failed', persisted: false, error: result.error, code: result.code };
      try { current.api.publish(); } catch (error) { return { status: 'failed', persisted: true, revision: result.revision, visible: 'unknown', retrySafe: false, error: error.message }; }
      return { status: 'persisted', persisted: true, broadcast: 'attempted', uiObserved: false, revision: result.revision, view: result.view, visible: 'unknown', sessionsDeleted: false, executionChanged: false };
    }).catch(function (error) { return { status: 'failed', retrySafe: false, error: error.message }; });
    ctx.state.requests.set(args.requestId, { key: key, promise: promise, created: Date.now() }); return promise;
  }
  return { read: read, inspect: inspect, act: act };
}
module.exports = { attachSplitViewControls: attachSplitViewControls };
