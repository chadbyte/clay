var test = require('node:test'), assert = require('node:assert/strict'), crypto = require('node:crypto');
var attach = require('../lib/server-contextual-mate-sessions').attachContextualMateSessions;
function fixture() {
  var replies = [], sessions = new Map(), created = 0, resolve = null;
  var mate = { id: 'mate_one', createdBy: 'owner', createdAt: 1 }, live = true;
  var manager = { sessions: sessions, createSessionRaw: function (options) { var session = Object.assign({ localId: ++created, sessionOriginId: crypto.randomUUID() }, options); sessions.set(created, session); return session; }, saveSessionFile: function () {} };
  var workspace = { path: '/isolated', isMate: true, mateId: mate.id, projectOwnerId: 'owner' };
  var project = { getStatus: function () { return workspace; }, getSessionManager: function () { return manager; } };
  var service = attach({ isActorLive: function (ws, owner) { return live && ws.owner === owner; }, findMateProject: function (owner, id) { return id === mate.id ? { ctx: project, mate: mate } : null; },
    ownsSession: function (session, owner) { return session && !session.hidden && session.ownerId === owner; },
    listHomeSessions: function (found, owner) { return Array.from(sessions.values()).filter(function (s) { return s.ownerId === owner; }); },
    resolveHomeSession: function (found, owner, reference) { var session = sessions.get(Number(reference.replace('local:', ''))); return session && !session.hidden && session.ownerId === owner ? session : null; },
    homeModels: { resolveMateModel: async function () { if (resolve) await resolve; return { vendor: 'claude', model: 'fixture' }; } }, sendMessage: function (ws, message) { replies.push(message); } });
  return { service: service, workspace: workspace, project: project, sessions: sessions, replies: replies, mate: mate, manager: manager, ws: { owner: 'owner' }, delay: function (promise) { resolve = promise; }, revoke: function () { live = false; } };
}
function message(f, type) { return { type: 'home_mate_' + (type || 'new_session'), presentation: 'contextual', mateId: f.mate.id, mateStamp: JSON.stringify([f.mate.id, f.mate.createdBy, f.mate.createdAt, null]), requestId: 'mate-conversations-' + crypto.randomUUID() }; }
async function settle() { await new Promise(function (resolve) { setImmediate(resolve); }); }
test('background creation is exactly once across concurrent retries; lookup never creates or replays deleted sessions', async function () {
  var f = fixture(), msg = message(f), release;
  f.delay(new Promise(function (resolve) { release = resolve; }));
  f.service.handle(f.ws, 'owner', msg); f.service.handle(f.ws, 'owner', msg); release(); await settle();
  assert.equal(f.sessions.size, 1); assert.equal(f.replies.length, 2); assert.equal(f.replies[0].sessionOriginId, f.replies[1].sessionOriginId);
  assert.equal(f.sessions.get(1).history, undefined); assert.equal(f.sessions.get(1).contextualCreationMateStamp, msg.mateStamp);
  f.sessions.delete(1); f.service.handle(f.ws, 'owner', msg); await settle(); assert.equal(f.sessions.size, 0); assert.equal(f.replies.at(-1).ok, false);
  f.service.handle(f.ws, 'owner', Object.assign(message(f), { lookupOnly: true })); await settle(); assert.equal(f.sessions.size, 0); assert.equal(f.replies.at(-1).ok, false);
});
test('list/open deny foreign, missing, hidden and stale exact session identities', async function () {
  var f = fixture(); f.sessions.set(1, { localId: 1, ownerId: 'foreign', sessionOriginId: 'foreign' });
  f.service.handle(f.ws, 'owner', message(f, 'sessions_list')); await settle(); assert.deepEqual(f.replies.at(-1).sessions, []);
  var msg = Object.assign(message(f, 'session_open'), { sessionId: 'local:1', sessionOriginId: 'foreign' });
  f.service.handle(f.ws, 'owner', msg); await settle(); assert.equal(f.replies.at(-1).ok, false);
  f.sessions.get(1).ownerId = 'owner'; msg.sessionOriginId = 'stale'; f.service.handle(f.ws, 'owner', msg); await settle(); assert.equal(f.replies.at(-1).ok, false);
  msg.sessionOriginId = 'foreign'; f.service.handle(f.ws, 'owner', msg); await settle(); assert.equal(f.replies.at(-1).ok, true);
  f.sessions.get(1).hidden = true; f.service.handle(f.ws, 'owner', msg); await settle(); assert.equal(f.replies.at(-1).ok, false);
});
['revoked', 'replaced', 'deleted', 'foreign', 'archived', 'directory', 'workspace-owner', 'manager'].forEach(function (condition) {
  test('revalidates ' + condition + ' Mate/account across model resolution', async function () {
    var f = fixture(), msg = message(f), release;
    f.delay(new Promise(function (resolve) { release = resolve; })); f.service.handle(f.ws, 'owner', msg);
    if (condition === 'revoked') f.revoke();
    if (condition === 'replaced') f.mate.createdAt = 2;
    if (condition === 'deleted') f.mate.lifecycleDeletion = true;
    if (condition === 'foreign') f.mate.createdBy = 'foreign';
    if (condition === 'archived') f.mate.archived = true;
    if (condition === 'directory') f.workspace.path = '/changed';
    if (condition === 'workspace-owner') f.workspace.projectOwnerId = 'foreign';
    if (condition === 'manager') f.project.getSessionManager = function () { return { sessions: new Map() }; };
    release(); await settle(); assert.equal(f.sessions.size, 0); assert.equal(f.replies.at(-1).ok, false);
  });
});
