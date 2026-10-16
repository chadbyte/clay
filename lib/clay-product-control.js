var crypto = require("crypto");
var builtinMates = require("./builtin-mates");
var accessModule = require("./workspace-query-access");
var refs = require("./workspace-query-service");
var provenance = require("./session-provenance");
var personal = require("./mcp-session-access");

var input = require("./clay-product-control-input");
var ACTIONS = input.ACTIONS;
var KEYS = input.KEYS;
var deleteScope = require("./project-session-delete").resolveDeletionScope;
function revision(session) {
  return JSON.stringify([session.ownerId, session.sessionOriginId, session.cliSessionId, session.title, session.vendor,
    session.model, session.effort, session.permissionMode, session.mode, session.runtimeMode, session.hidden,
    session.isProcessing, session._queryStarting, session.taskStopRequested, session._pendingMessageDrainPaused,
    session._sdkQueryGeneration, session.history && session.history.length, session.messageUUIDs,
    session.sessionProvenance, session.pendingPush, Object.keys(session.pendingPermissions || {}), Object.keys(session.pendingAskUser || {})]);
}
function string(value, max) { return typeof value === "string" && value.trim() && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value); }
function attachClayProductControl(ctx) {
  var access = accessModule.attachWorkspaceQueryAccess(ctx);
  var states = new WeakMap();
  var busy = new WeakSet();
  function bind(source) {
    if (!source || !source.session) return null;
    var session = source.session, generation = Number(session._sdkQueryGeneration || 0);
    var sourceProject = ctx.getProjects().get(source.projectSlug);
    function authorize() {
      var project = ctx.getProjects().get(source.projectSlug);
      if (!project || project !== sourceProject) throw new Error("Source project was deleted or replaced.");
      var status = project.getStatus(), manager = project.getSessionManager();
      var mate = ctx.resolveMate(source.projectOwnerId, source.mateId);
      var definition = mate && builtinMates.getBuiltinByKey(mate.builtinKey);
      if (!status || !status.isMate || status.mateId !== source.mateId || status.projectOwnerId !== source.projectOwnerId || !mate || mate.lifecycleDeletion || mate.id !== source.mateId || mate.builtinKey !== "clay" || !definition || !definition.hostAgent || (ctx.isMultiUser() && mate.createdBy !== source.projectOwnerId)) throw new Error("Canonical Clay ownership is no longer valid.");
      if (manager.sessions.get(session.localId) !== session || Number(session._sdkQueryGeneration || 0) !== generation || session.taskStopRequested || session.abortController && session.abortController.signal.aborted || session.spawn || provenance.isWorker(session) || session.homeDebatePlanning || session.debateSetupMode || session._mentionInProgress) throw new Error("This canonical Clay query is stale or stopped.");
      if (session.destroying || session.hidden || session.mateCreationMode || session._mcpForeignInput || session.sessionVisibility === "shared" || session.delegated || session._delegatedBy || session._pairDelegation) throw new Error("Product controls require a private, owner-authored canonical Clay conversation.");
      if (ctx.isMultiUser() && !personal.canUsePersonalConnections(session, manager.sessions)) throw new Error("Foreign input cannot authorize personal product controls.");
      if (!ctx.isMultiUser() && (session.ownerId || (session.history || []).some(function (entry) { return entry.type === "user_message" && entry.from && entry.from !== "default"; }))) throw new Error("Foreign input cannot authorize personal product controls.");
      if (ctx.isMultiUser() && (!source.projectOwnerId || session.ownerId !== source.projectOwnerId || !ctx.findUser(source.projectOwnerId))) throw new Error("The source owner is no longer available.");
      if (!ctx.isMultiUser() && session.ownerId && session.ownerId !== source.projectOwnerId) throw new Error("Source ownership changed.");
      return { userId: ctx.isMultiUser() ? source.projectOwnerId : null, singleUserOwnerId: source.projectOwnerId || null };
    }
    try { authorize(); } catch (error) { return null; }
    var state = states.get(session);
    if (!state || state.generation !== generation) { state = { generation: generation, targets: new Map(), requests: new Map() }; states.set(session, state); }
    var display = require('./clay-control-presentation-binding').bindPresentation({
      state: state, session: session, authorize: authorize, access: access,
      getProjects: ctx.getProjects, getOwnerUi: ctx.getOwnerUi, getMateDir: ctx.getMateDir,
      resolveMate: ctx.resolveMate, canUsePath: ctx.canUsePath, multiUser: ctx.isMultiUser,
      ownerId: source.projectOwnerId, sourceSlug: source.projectSlug, mateId: source.mateId
    });
    function review(question, check, presentation) {
      return display.review(function (text, validate, summary) { return sourceProject.requestProductControlReview(session, text, validate, summary); }, question, check, presentation);
    }
    function resolve(slug, ref) {
      var principal = authorize(), project = ctx.getProjects().get(slug);
      var status = project && project.getStatus();
      if (!status || status.isMate || !access.evaluate(principal, status).accessible) throw new Error("Target project is unavailable or private.");
      var sm = project.getSessionManager(), target = null;
      sm.sessions.forEach(function (candidate) { if (refs.sessionRef(slug, candidate) === ref) target = candidate; });
      if (!target || target.hidden || (ctx.isMultiUser() ? target.ownerId !== principal.userId : !!target.ownerId && target.ownerId !== principal.singleUserOwnerId)) throw new Error("Target session is unavailable or belongs to another owner.");
      if (target.spawn || provenance.isWorker(target)) throw new Error("Worker sessions are operated by their project Driver.");
      return { project: project, session: target, principal: principal };
    }
    function scope(project, target) {
      var sm = project.getSessionManager();
      var plan = deleteScope(sm.sessions, [target], function (item) { return (item.ownerId || null) === (target.ownerId || null); });
      if (!plan.ok) throw new Error(plan.error);
      return plan.ids.map(function (id) { var item = sm.sessions.get(id); return { item: item, revision: revision(item) }; });
    }
    function check(target, queueRequired, terminalClosing) {
      if (Date.now() - target.created > 300000) throw new Error("Target inspection expired.");
      var live = resolve(target.slug, target.ref);
      if (!terminalClosing && (live.project.inspectProductSessionRuntime ? live.project.inspectProductSessionRuntime(live.session) : JSON.stringify([live.session.terminalId, live.session.runtimeTerminalId, live.session.tuiSuspended])) !== target.terminalRevision) throw new Error("Terminal runtime changed. Inspect again.");
      if (live.project !== target.project || live.session !== target.session || revision(live.session) !== target.revision) throw new Error("The exact target revision changed. Inspect again before requesting a new action.");
      if (queueRequired && live.project.inspectProductSessionQueue(live.principal, live.session).revision !== target.queueRevision) throw new Error("The queue revision changed. Inspect and review again.");
      var current = scope(live.project, live.session);
      if (current.length !== target.scope.length || current.some(function (entry, i) { return entry.item !== target.scope[i].item || entry.revision !== target.scope[i].revision; })) throw new Error("Driver or owned Worker revision changed. Inspect again.");
      return live;
    }
    function capabilities() {
      authorize();
      return { screen: { tools: ["read_owner_screen", "inspect_owner_screen_change", "control_owner_screen"], scope: "Exact authenticated owner UI connection and owned conversation navigation; delivery and client acceptance do not prove rendering. Screen context is server-known connection/conversation only. Owner notification read and reviewed exact dismissal use the existing queue. No arbitrary messages, settings or contextual UI.", receipts: "Query-local attempts survive catalog rebinding only. Read delivery status; never blindly repeat an uncertain delivery." }, actions: ACTIONS, scheduling: { tools: ["begin_schedule_control_interview", "read_schedule_controls", "inspect_schedule_change", "control_schedules"], mates: "Own and same-owner private Mate conversation list/read/create/update/cancel. No pause/resume/run-now action exists for logical Mate schedules.", projects: "Selected owned ordinary-project Driver list/read, proposed creation requiring final workbench Create task, reviewed update/pause/resume/cancel/run through existing scheduling services. Run is queued, never task completion; Workers remain owned by the project scheduled executor.", receipts: "Dated request IDs; 24-hour receipt window, at most 100 retained receipts on the source conversation. Interrupted writes require inspection, never blind execution." }, projectRecords: { tools: ["read_project_records", "inspect_project_record_change", "control_project_records"], scope: "Selected owned ordinary projects, including worktree context. Exact owner review; query-local bounded retry receipts.", unsupported: ["githubFiling", "workSessionLaunch", "scheduledResultMutation"], routing: "Use the existing reviewed project assignment or follow-up tools for Driver execution. Record changes never run Git commits." }, mateKnowledge: { tools: ["read_mate_knowledge_control", "inspect_mate_knowledge_change", "control_mate_knowledge"], review: "Exact owner-reviewed Markdown and typed database/record operations; serialized intents are limited to 1400 characters within the existing review card.", unsupported: ["hardDatabaseOrRecordDeletion", "legacyJsonlWrites", "promotionOrSharing", "arbitraryFilesystemOrSql", "userKnowledgeCuration"] }, mateLifecycle: { actions: ["list", "inspect", "profile", "delete"], profileFields: ["name", "bio", "workspaceColor", "avatarCatalogId"], deletion: "Idle owner-private Mates only; canonical Clay and primary Mates are protected. Stored transcripts and provider history are retained. Pending runtime cleanup without closure proof requires operator recovery.", excluded: ["knowledge", "directMessages", "schedules", "sharing", "ownershipTransfer", "model"] }, mateChat: { tools: ["read_mate_chat_control", "inspect_mate_chat_change", "control_mate_chat"], actions: ["send", "stop", "model", "vendor", "effort"], scope: "Exact existing same-owner private Mate conversation; vendor selection requires a fresh idle conversation. Delegated messages are untrusted and never owner input. Dated durable retry receipts, no implicit resume or thread migration." }, workspace: { tools: ["read_project_workspace", "read_workspace_receipt", "inspect_workspace_change", "control_project_workspace"], files: "Bounded list/read and exact reviewed writes to existing regular text files within a selected owned ordinary project. Symlinks, hardlinks, managed settings, create/delete/move and arbitrary filesystem operations are excluded.", git: "Status and changed-file diff; exact reviewed selected-path stage/unstage only. No linked Git metadata/submodules, commits, pull/push, PR operations or arbitrary Git arguments.", terminal: "Owner shell list/scrollback and reviewed blank shell creation, rename, resize and acknowledged close. No input, commands, coding-agent/login terminals or Worker control." }, approval: "All changes except Stop require an authenticated owner review of the exact action and target revision.",
        taskExecution: "Use propose_project_assignment or propose_project_follow_up to route execution through a project Driver. A stopped session cannot be resumed by this control layer.",
        unsupported: { archive: "No authoritative session archive service exists.", send: "Use reviewed Driver assignment or follow-up.", runtime: "New TUI presentation and cross-provider thread migration are unavailable. runtime=gui closes a legacy Claude terminal with acknowledged exit. vendor_new_session creates a private blank GUI session and retains the original without execution.", projectLifecycle: ctx.projectLifecycle ? "Create, register, rename, remove registration, project environment and owner access controls use exact human review. OS filesystem sharing changes are unavailable through this service." : "Unavailable in this runtime." },
        excluded: ["serverSettings", "userSettings", "workerCreation", "pairOrchestration"] };
    }
    function inspect(args) {
      if (!args || Object.keys(args).some(function (key) { return ["projectSlug", "sessionRef"].indexOf(key) < 0; }) || !string(args.projectSlug, 200) || !/^session:[\w-]{24}$/.test(args.sessionRef)) throw new Error("An exact projectSlug and opaque sessionRef are required.");
      var live = resolve(args.projectSlug, args.sessionRef), target = live.session;
      if (state.targets.size >= 100) state.targets.delete(state.targets.keys().next().value);
      var queue = typeof live.project.inspectProductSessionQueue === "function" ? live.project.inspectProductSessionQueue(live.principal, target) : null;
      var token = "control:" + crypto.randomUUID();
      state.targets.set(token, { slug: args.projectSlug, ref: args.sessionRef, project: live.project, session: target, ownerId: target.ownerId || null, queueRevision: queue && queue.revision, terminalRevision: live.project.inspectProductSessionRuntime ? live.project.inspectProductSessionRuntime(target) : JSON.stringify([target.terminalId, target.runtimeTerminalId, target.tuiSuspended]), revision: revision(target), scope: scope(live.project, target), created: Date.now() });
      var sm = live.project.getSessionManager(), vendor = target.vendor || sm.defaultVendor || "claude";
      var caps = (sm.capabilitiesByVendor || {})[vendor] || {};
      return { queue: queue, availableVendors: sm.availableVendors || [], runtimeMode: target.runtimeMode || target.mode || "gui", runtimeTransition: "Only legacy Claude terminal to GUI chat is supported; terminal exit must be acknowledged. No execution starts.", vendorTransition: "vendor selects a fresh idle GUI Driver provider; vendor_new_session creates a private blank session and retains an established original without migrating history.", targetToken: token, projectSlug: args.projectSlug, sessionRef: args.sessionRef, title: target.title || "New Session", vendor: vendor, model: target.model || null, effort: target.effort || null, permissionMode: target.permissionMode || "default", processing: !!target.isProcessing, stopped: !!target.taskStopRequested, queuePaused: !!target._pendingMessageDrainPaused,
        providerCapabilities: { fork: caps.fork === true, conversationRewind: caps.rollback === true || caps.rewind === true, effort: caps.effort === true, modelCatalogAvailable: !!((sm.modelsByVendor || {})[vendor] || []).length }, deletionCount: scope(live.project, target).length, checkpoints: (target.messageUUIDs || []).map(function (entry) { return { uuid: entry.uuid, type: entry.type }; }), actions: ACTIONS, models: (sm.modelsByVendor || {})[vendor] || [], permissions: require("./session-permission-mode").clientState(target, sm.currentPermissionMode, vendor), expiresInSeconds: 300 };
    }
    async function run(args, target) {
      var queueAction = args.action.indexOf("queue_") === 0;
      var live = check(target, queueAction);
      if (Date.now() - target.created > 300000) throw new Error("Target inspection expired.");
      if (args.action !== "stop") {
        var question = input.description(args) + "\nProject: " + target.slug + "\nSession: " + (live.session.title || "New Session") + " (" + target.ref + ")\nWhy: " + args.why;
        if (queueAction) question += "\nQueue revision: " + target.queueRevision + ". Queue changes never resume a stopped Driver.";
        if (args.action === "delete") question += "\nPermanently deletes " + target.scope.length + " sessions: this Driver and all its owned Worker history. Inspect again if anything changes.";
        var result = await review(question, function () { authorize(); check(target, queueAction); });
        if (result.status !== "submitted" || !result.answers.control || result.answers.control.length !== 1 || result.answers.control[0] !== "Apply exact change") return { status: "cancelled", action: args.action };
        live = check(target, queueAction);
      }
      if (!queueAction && live.session.taskStopRequested && args.action !== "stop" && args.action !== "rename" && args.action !== "delete") throw new Error("The target was stopped. Resume it explicitly through its Driver.");
      if (typeof live.project.applyProductSessionAction !== "function") throw new Error("Target project controls are unavailable.");
      if (busy.has(live.session)) throw new Error("Another control action is applying to this target. Inspect again after it settles.");
      if (args.action === "stop" && display.current()) display.current().start("running");
      busy.add(live.session);
      var result;
      try { result = await live.project.applyProductSessionAction(live.principal, live.session, args.action, args.value, function () { check(target, queueAction, args.action === "runtime"); }, { args: args, requestKey: source.projectSlug + "\n" + (session.sessionOriginId || session.localId) + "\n" + args.requestId }); }
      finally { busy.delete(live.session); }
      return Object.assign({ status: "completed", action: args.action, projectSlug: target.slug, sessionRef: target.ref, why: args.why }, result);
    }
    function act(args) {
      authorize();
      input.validate(args);
      args = Object.assign({}, args);
      if (args.ids) args.ids = args.ids.slice();
      var target = state.targets.get(args.targetToken);
      if (!target) throw new Error("Inspect the exact target first.");
      var key = JSON.stringify(KEYS.map(function (name) { return args[name] === undefined ? null : args[name]; }));
      var old = state.requests.get(args.requestId);
      if (old) { if (old.key !== key) throw new Error("requestId already names a different exact action."); var project = ctx.getProjects().get(target.slug);
        if (project !== target.project || !access.evaluate(authorize(), project.getStatus()).accessible) throw new Error("Target access changed.");
        var current = project.getSessionManager().sessions.get(target.session.localId);
        if (current && (current !== target.session || (current.ownerId || null) !== target.ownerId)) throw new Error("Target was replaced.");
        return old.promise; }
      if (state.requests.size >= 100) throw new Error("Too many control requests in this query.");
      var promise = Promise.resolve().then(function () { return run(args, target); }).catch(function (error) { return Object.assign({ status: "failed", action: args.action, error: error.message }, error.productControlResult || {}); });
      state.requests.set(args.requestId, { key: key, promise: promise });
      return promise;
    }
    if (!state.lifecycle) state.lifecycle = { targets: new Map(), requests: new Map() };
    var lifecycle = require("./clay-project-lifecycle").attachClayProjectLifecycle({
      state: state.lifecycle, service: ctx.projectLifecycle, authorize: authorize, getProjects: ctx.getProjects, findUser: ctx.findUser,
      permissions: ctx.lifecyclePermissions, canUsePath: ctx.canUsePath, getAccess: ctx.onGetProjectAccess,
      sourceKey: source.projectSlug + "\n" + (session.sessionOriginId || session.localId),
      creationRevision: function (anchor) { return ctx.projectLifecycle.creationRevision(anchor); },
      review: function (question, check) { return review(question, check); },
    });
    if (!state.mates) state.mates = { targets: new Map(), requests: new Map() };
    var mateControls = require('./clay-mate-lifecycle').attachClayMateLifecycle({ state: state.mates, authorize: authorize,
      getService: ctx.getMateLifecycle, getProjects: ctx.getProjects,
      review: function (question, check) { return review(question, check); } });
    if (!state.knowledge) state.knowledge = { targets: new Map(), requests: new Map() };
    var knowledgeControls = require('./clay-mate-knowledge').attachClayMateKnowledge({ state: state.knowledge, authorize: authorize,
      getProjects: ctx.getProjects, resolveMate: ctx.resolveMate, getMateDir: ctx.getMateDir,
      sourceKey: source.projectSlug + '\n' + (session.sessionOriginId || session.localId),
      review: function (question, check) { return review(question, check); } });
    if (!state.records) state.records = { targets: new Map(), requests: new Map() };
    var recordControls = require('./clay-project-records').attachClayProjectRecords({ state: state.records, authorize: authorize,
      services: function () { return ctx.getRecordServices && ctx.getRecordServices(); },
      resolve: function (slug) {
        var principal = authorize(), project = ctx.getProjects().get(slug), status = project && project.getStatus();
        var decision = status && access.evaluate(principal, status);
        if (!status || status.isMate || !decision.owned || !decision.accessible) throw new Error('Selected records require an owned ordinary project with live access.');
        if (status.isWorktree) {
          var parent = ctx.getProjects().get(status.parentSlug), parentStatus = parent && parent.getStatus();
          if (!parentStatus || parentStatus.isMate || !access.evaluate(principal, parentStatus).owned || !access.evaluate(principal, parentStatus).accessible) throw new Error('Selected worktree records require live parent ownership and access.');
        }
        return { principal: principal, project: project, status: status };
      },
      actor: function () { authorize(); provenance.ensureOrigin(session); return { type: 'canonicalClay', userId: session.ownerId || null, displayName: 'Clay', sourceProjectSlug: source.projectSlug, mateId: source.mateId, sessionKey: session.cliSessionId || 'local:' + session.localId, sessionOriginId: session.sessionOriginId, vendor: session.vendor || null }; },
      review: function (question, check) { return review(question, check); } });
    if (!state.scheduling) state.scheduling = { targets: new Map(), requests: new Map(), interview: false };
    var scheduleControls = require('./clay-scheduling').attachClayScheduling({ state: state.scheduling, authorize: authorize, session: session,
      multiUser: ctx.isMultiUser, getProjects: ctx.getProjects, resolveMate: ctx.resolveMate, getMateDir: ctx.getMateDir,
      mateSlug: function (id) {
        var found;
        ctx.getProjects().forEach(function (project, slug) { var status = project.getStatus(); if (status.isMate && status.mateId === id) found = slug; });
        if (!found) throw new Error('The Mate scheduling runtime is unavailable.'); return found;
      },
      authorizeProject: function (principal, status) {
        var decision = access.evaluate(principal, status);
        if (!decision.owned || !decision.accessible) throw new Error('Scheduling requires live ordinary-project ownership and access.');
        if (status.isWorktree) { var parent = ctx.getProjects().get(status.parentSlug), parentStatus = parent && parent.getStatus(); if (!parentStatus || parentStatus.isMate || !access.evaluate(principal, parentStatus).owned || !access.evaluate(principal, parentStatus).accessible) throw new Error('Scheduling requires live parent-project ownership and access.'); }
      },
      actor: function () { authorize(); provenance.ensureOrigin(session); return { type: 'canonicalClay', userId: session.ownerId || null, sourceProjectSlug: source.projectSlug, mateId: source.mateId, sessionOriginId: session.sessionOriginId, vendor: session.vendor || null }; },
      sourceKey: source.projectSlug + '\n' + (session.sessionOriginId || session.localId),
      save: function () { return sourceProject.getSessionManager().saveSessionFile(session); },
      review: function (question, check) { return review(question, check); } });
    if (!state.mateChat) state.mateChat = { targets: new Map(), requests: new Map() };
    var mateChatControls = require('./clay-mate-chat').attachClayMateChat({
      state: state.mateChat, authorize: authorize, session: session, multiUser: ctx.isMultiUser, activity: display.current,
      sourceIdentity: function () {
        var status = sourceProject.getStatus(), owner = source.projectOwnerId || 'default';
        if (require('path').resolve(status.path) !== require('path').resolve(ctx.getMateDir(owner, source.mateId))) throw new Error('The canonical source Mate directory changed.');
        return sourceProject.getMateChatControl().validate(session);
      },
      getProjects: ctx.getProjects, resolveMate: ctx.resolveMate, getMateDir: ctx.getMateDir,
      save: function () { return sourceProject.getSessionManager().saveSessionFile(session); },
      actor: function () { authorize(); return { mateId: source.mateId, sourceProjectSlug: source.projectSlug, sourceSessionRef: refs.sessionRef(source.projectSlug, session) }; },
      review: function (question, check) { return review(question, check); },
    });
    if (!state.workspace) state.workspace = { targets: new Map(), requests: new Map() };
    var workspaceControls = require('./clay-workspace-controls').attachWorkspaceControls({
      state: state.workspace, session: session, authorize: authorize, getProjects: ctx.getProjects,
      sourceIdentity: function () {
        var status = sourceProject.getStatus(), owner = source.projectOwnerId || 'default';
        if (require('path').resolve(status.path) !== require('path').resolve(ctx.getMateDir(owner, source.mateId))) throw new Error('Canonical source directory changed.');
        return sourceProject.getMateChatControl().validate(session);
      },
      authorizeProject: function (principal, status) {
        var decision = access.evaluate(principal, status);
        if (!decision.owned || !decision.accessible) throw new Error('Workspace controls require current ordinary-project ownership and access.');
        if (status.isWorktree) {
          var parent = ctx.getProjects().get(status.parentSlug), parentStatus = parent && parent.getStatus();
          if (!parentStatus || parentStatus.isMate || !access.evaluate(principal, parentStatus).owned || !access.evaluate(principal, parentStatus).accessible) throw new Error('Worktree controls require current parent ownership and access.');
        }
      },
      save: function () { return sourceProject.getSessionManager().saveSessionFile(session); },
      review: function (question, check) { return review(question, check); },
    });
    if (!state.screen) state.screen = { targets: new Map(), requests: new Map() };
    var screenControls = require('./clay-screen-controls').attachScreenControls({
      state: state.screen, session: session, authorize: authorize, getProjects: ctx.getProjects, activity: display.current,
      getService: ctx.getOwnerUi, getNotifications: ctx.getNotifications,
      sourceIdentity: function () {
        var status = sourceProject.getStatus(), owner = source.projectOwnerId || 'default';
        if (require('path').resolve(status.path) !== require('path').resolve(ctx.getMateDir(owner, source.mateId))) throw new Error('Canonical source directory changed.');
        return sourceProject.getMateChatControl().validate(session);
      },
      authorizeProject: function (principal, status) {
        if (status.isMate) {
          var mate = ctx.resolveMate(source.projectOwnerId, status.mateId);
          if (!mate || mate.lifecycleDeletion || status.projectOwnerId !== source.projectOwnerId || ctx.isMultiUser() && mate.createdBy !== source.projectOwnerId || require('path').resolve(status.path) !== require('path').resolve(ctx.getMateDir(source.projectOwnerId || 'default', status.mateId))) throw new Error('Private Mate navigation access denied.');
        } else {
          var decision = access.evaluate(principal, status);
          if (!decision.owned || !decision.accessible || ctx.canUsePath && !ctx.canUsePath(principal.userId, status.path)) throw new Error('Navigation requires current project ownership and access.');
          if (status.isWorktree) { var parent = ctx.getProjects().get(status.parentSlug), parentStatus = parent && parent.getStatus(); if (!parentStatus || !access.evaluate(principal, parentStatus).owned || !access.evaluate(principal, parentStatus).accessible) throw new Error('Worktree parent access changed.'); }
        }
      },
      review: function (question, check, presentation) { return review(question, check, presentation); }
    });
    return display.decorate(Object.assign({ _presentation: display, capabilities: capabilities, inspect: inspect, act: act, inspectProject: lifecycle.inspectProject, actProject: lifecycle.actProject }, mateControls, knowledgeControls, recordControls, scheduleControls, mateChatControls, workspaceControls, screenControls));
  }
  return { bind: bind };
}
module.exports = { attachClayProductControl: attachClayProductControl };
