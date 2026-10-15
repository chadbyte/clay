// Set HOME and CLAY_HOME before requiring this production-path fixture.
var fs = require('fs');
var path = require('path');
var users = require('../../lib/users');
var mates = require('../../lib/mates');
var yoke = require('../../lib/yoke');
var createProject = require('../../lib/project').createProjectContext;
var attachScheduler = require('../../lib/durable-scheduler').attachDurableScheduler;
var root = process.env.CLAY_HOME;
if (!root || root.indexOf(require('os').tmpdir()) !== 0) throw new Error('An isolated temporary CLAY_HOME is required.');

function runtime(options) {
  options = options || {};
  users.enableMultiUser();
  var owner = users.findUserByUsername('schedule-owner') || users.createUser({ username: 'schedule-owner', pin: 'fixture-only' }).user;
  var stranger = users.findUserByUsername('schedule-stranger') || users.createUser({ username: 'schedule-stranger', pin: 'fixture-only' }).user;
  var projects = new Map();
  var captures = [];
  var events = [];
  var access = true;
  // The provider transport is the only replaced application dependency.
  var adapter = { vendor: 'codex', renameSession: async function () {}, init: async function () { return { capabilities: {}, models: [{ value: 'fixture-model', displayName: 'Fixture model' }], defaultModel: 'fixture-model' }; }, createToolServer: function () { return null; },
    createQuery: async function (options) {
      if (Array.isArray(options.dynamicTools)) captures.push(options);
      return { pushMessage: function () { return true; }, close: function () {},
        [Symbol.asyncIterator]: function () { var step = 0; return { next: async function () { step++; if (step === 1) return { done: false, value: { yokeType: 'session_started', sessionId: options.resume || 'fixture-provider-' + captures.length } }; if (step === 2) return { done: false, value: { yokeType: 'result', result: 'Fixture transport completed.' } }; return { done: true }; } }; } };
    } };
  if (options.vendor === 'claude') {
    adapter = require('../../lib/yoke/adapters/claude').createClaudeAdapter({ cwd: root, loadSDK: async function () {
      return { query: function (args) {
        captures.push(args.options);
        return { close: function () {}, [Symbol.asyncIterator]: function () { return { next: async function () { return { done: true }; } }; } };
      } };
    } });
  }
  var originalFactory = yoke.createAdapters;
  yoke.createAdapters = function () { var adapters = {}; adapters[options.vendor || 'codex'] = adapter; return { adapters: adapters }; };
  var scheduler = attachScheduler({ namespace: options.namespace || 'mate-fixture-' + require('crypto').randomUUID(), storageDir: root });
  function addProject(cwd, slug, title, ignored, ownerId, ignored2, flags) {
    var project = createProject({ cwd: cwd, slug: slug, title: title, projectOwnerId: ownerId,
      isMate: flags.isMate, mateId: path.basename(cwd), isHostAgent: flags.isHostAgent || false,
      durableScheduler: scheduler,
      createReadyMate: function (ws, userId, definition) { return server.createReadyMateFromInterview(ws, userId, definition); },
      canAccessProjectSlug: function (actor) { return access && actor === ownerId && !!mates.getMate(mates.buildMateCtx(actor), path.basename(cwd)); },
      getProjectAccess: function () { return { isMate: true, ownerId: ownerId, visibility: 'private' }; },
    });
    projects.set(slug, project);
    return true;
  }
  var server = require('../../lib/server-mates').attachMates({ users: users, mates: mates, projects: projects,
    addProject: addProject, removeProject: function (slug) { var p = projects.get(slug); if (p) p.destroy(); projects.delete(slug); } });
  function definition(intent) {
    return { name: 'Schedule Mate', bio: 'An isolated scheduling partner.', relationship: 'Collaborator',
      activities: ['Daily review'], communicationStyle: ['Concise'], autonomy: 'Ask before acting.',
      identityMarkdown: '# Schedule Mate\n\n' + 'I help my owner review the day with clear questions and useful summaries. '.repeat(6),
      vendor: options.vendor || 'codex', model: 'fixture-model', scheduleIntent: intent || null };
  }
  function open(mate, host) {
    var cwd = mates.getMateDir(mates.buildMateCtx(owner.id), mate.id);
    addProject(cwd, 'mate-' + mate.id, mate.name, null, owner.id, null, { isMate: true, isHostAgent: !!host });
    var project = projects.get('mate-' + mate.id);
    var sm = project.getSessionManager();
    var session = Array.from(sm.sessions.values()).find(function (item) { return item.ownerId === owner.id; }) || sm.createSessionRaw({ ownerId: owner.id, vendor: options.vendor || 'codex', model: 'fixture-model' });
    return { mate: mate, project: project, sm: sm, session: session };
  }
  function create(intent) {
    var mate = server.createReadyMateFromInterview(null, owner.id, definition(intent));
    var project = projects.get('mate-' + mate.id);
    var sm = project.getSessionManager();
    var session = Array.from(sm.sessions.values()).find(function (item) { return item.ownerId === owner.id; }) || sm.createSessionRaw({ ownerId: owner.id, vendor: options.vendor || 'codex', model: 'fixture-model' });
    return { mate: mate, project: project, sm: sm, session: session };
  }
  async function tools(target) {
    target.session.isProcessing = false;
    target.session._queryStarting = false;
    await target.project.sdk.startQuery(target.session, 'Fixture provider transport', null, null);
    target.session.isProcessing = false;
    target.session._queryStarting = false;
    return target.project.sdk.getQueryToolDefs(target.session, Number(target.session._sdkQueryGeneration));
  }
  function ws(target, actor) {
    return { readyState: 1, _clayUser: actor || owner, _clayActiveSession: target.session.localId,
      send: function (raw) { events.push(JSON.parse(raw)); } };
  }
  async function close() {
    for (var project of projects.values()) await project.destroy();
    projects.clear();
    await scheduler.shutdown();
    yoke.createAdapters = originalFactory;
  }
  return { users: users, mates: mates, owner: owner, stranger: stranger, projects: projects, scheduler: scheduler,
    captures: captures, events: events, server: server, create: create, open: open, tools: tools, ws: ws, definition: definition,
    setAccess: function (value) { access = value; }, close: close };
}
module.exports = { runtime: runtime };
