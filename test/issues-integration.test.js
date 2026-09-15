var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var os = require('node:os');
var path = require('node:path');
var attachService = require('../lib/issues-service').attachIssuesService;
var attachProject = require('../lib/project-issues').attachProjectIssues;
var attachLinks = require('../lib/server-issue-links').attachIssueLinks;
var attachWork = require('../lib/project-issue-launch').attachIssueLaunch;
function fixture() {
  var directory = fs.mkdtempSync(path.join(os.tmpdir(), 'clay-issues-integration-'));
  var sessions = new Map(); var owner = { id: 'u1', displayName: 'Owner' }; var member = { id: 'u2', displayName: 'Member' }; var access = true;
  var status = { slug: 'app', path: directory, projectKnowledgeId: 'pk_issue_integration', projectOwnerId: 'u1' };
  var messages = []; var starts = []; var counter = 0;
  var sm = { sessions: sessions, installedVendors: ['codex'], createSessionRaw: function (options) { var session = Object.assign({ localId: ++counter }, options); sessions.set(session.localId, session); return session; }, saveSessionFile: function () {}, sendAndRecord: function (session, event) { session.history = (session.history || []).concat([event]); }, sendToSession: function () {}, broadcastSessionList: function () {}, switchSession: function (id, ws) { ws._clayActiveSession = id; }, deleteSession: function (id) { sessions.delete(id); } };
  var project = { getStatus: function () { return status; }, getSessionManager: function () { return sm; } };
  var projects = new Map([['app', project]]);
  var service = attachService({ getProjects: function () { return projects; }, isMultiUser: function () { return true; }, findUserById: function (id) { if (!access) return null; return id === 'u1' ? owner : id === 'u2' ? member : null; }, canAccessProject: function (id) { return id === 'u1' || id === 'u2'; }, baseDir: directory });
  var ws = { readyState: 1, _clayUser: owner };
  var bound = service.bindUser({ projectSlug: 'app', userId: 'u1' });
  var startWork = attachWork({ sm: sm, resolveDefaultAi: async function () { return { ready: true, vendor: 'codex', model: 'test' }; }, getSdk: function () { return { startQuery: function (session, prompt) { starts.push({ session: session, prompt: prompt }); session.queryInstance = {}; return Promise.resolve(); } }; }, getLinuxUserForSession: function () { return null; }, ensureProjectAccessForSession: function () { return null; }, onProcessingChanged: function () {}, sendTo: function (socket, message) { messages.push(message); } });
  var controller = attachProject({ service: service, projectSlug: 'app', sm: sm, getClients: function () { return [ws]; }, sendTo: function (socket, message) { messages.push(message); }, startWork: startWork });
  return { service: service, bound: bound, controller: controller, ws: ws, member: member, messages: messages, starts: starts, sm: sm, startWork: startWork, projects: projects, createDriverIssue: function (args) { var session = sm.createSessionRaw({ ownerId: 'u1' }); var driver = service.bindProjectSession({ projectSlug: 'app', session: session }); var result = driver.createIssue(args); sessions.delete(session.localId); return result; }, revoke: function () { access = false; }, cleanup: function () { fs.rmSync(directory, { recursive: true, force: true }); } };
}
async function flush() { await new Promise(function (resolve) { setImmediate(resolve); }); }
test('human WS creation is refused while Driver tools create, update, await writes, and report conflicts', async function () {
  var f = fixture();
  try {
    f.controller.handleMessage(f.ws, { type: 'issue_create', requestId: 'a', args: { title: 'Investigate crash', body: '<script>unsafe</script>' } });
    await flush();
    var response = f.messages.find(function (msg) { return msg.requestId === 'a'; }); assert.match(response.error, /cannot create issues directly/);
    var created = await f.createDriverIssue({ title: 'Investigate crash', body: '<script>unsafe</script>' });
    var session = f.sm.createSessionRaw({ ownerId: 'u1' });
    var defs = f.controller.getDynamicToolDefs(session);
    var update = defs.find(function (tool) { return tool.name === 'update_issue'; });
    var result = await update.handler({ ref: created.ref, expectedRevision: 1, summary: 'Investigating', status: 'in_progress' });
    assert.equal(JSON.parse(result.content[0].text).revision, 2);
    var stale = await update.handler({ ref: created.ref, expectedRevision: 1, summary: 'Lost update' }); assert.equal(stale.isError, true);
    session.sessionProvenance = { kind: 'worker' };
    assert.equal(f.controller.getDynamicToolDefs(session).length, 0);
    var revoked = await update.handler({ ref: created.ref, expectedRevision: 2, summary: 'Forged' }); assert.equal(revoked.isError, true);
  } finally { f.cleanup(); }
});
test('Start work links and dispatches the exact fresh session once; open is owner-bound', async function () {
  var f = fixture();
  try {
    var entry = await f.createDriverIssue({ title: 'Fix crash' });
    var request = { requestId: 'work-1', args: { ref: entry.ref, expectedRevision: 1 } };
    var results = await Promise.all([f.startWork(f.ws, request, f.bound), f.startWork(f.ws, request, f.bound)]);
    assert.equal(results[0].sessionId, results[1].sessionId); assert.equal(f.starts.length, 1);
    var latest = f.bound.readIssue({ ref: entry.ref }); assert.equal(latest.status, 'in_progress'); assert.equal(latest.linkedWorkSessions.length, 1);
    assert.equal(latest.linkedWorkSessions[0].issueRevision, 1); assert.equal(latest.linkedWorkSessions[0].requestId, 'work-1');
    var linked = f.bound.resolveWorkSession({ ref: entry.ref, sessionOriginId: latest.linkedWorkSessions[0].sessionId });
    assert.equal(linked.localId, f.starts[0].session.localId); assert.match(f.starts[0].prompt, /Do not commit/);
    await f.bound.updateIssue({ ref: entry.ref, expectedRevision: latest.revision, status: 'closed', closeReason: 'non_code_decision' });
    assert.equal(f.bound.resolveWorkSession({ ref: entry.ref, sessionOriginId: linked.sessionOriginId }).localId, linked.localId, 'closed issues retain navigable work history');
    f.revoke(); assert.throws(function () { f.bound.resolveWorkSession({ ref: entry.ref, sessionOriginId: linked.sessionOriginId }); }, /valid/);
  } finally { f.cleanup(); }
});
test('reference resolution exposes only currently authorized project metadata', async function () {
  var f = fixture();
  try {
    var entry = await f.createDriverIssue({ title: 'Private issue', body: 'Sensitive body' });
    var responses = [];
    var resolve = attachLinks({ service: f.service, projects: f.projects, sendMessage: function (ws, result) { responses.push(result); } });
    resolve(f.ws, { ref: entry.ref, requestId: 'link' }); assert.equal(responses[0].target.title, 'Private issue'); assert.equal(responses[0].target.body, undefined);
    f.revoke(); resolve(f.ws, { ref: entry.ref, requestId: 'revoked' }); assert.equal(responses[1].target, undefined); assert.ok(responses[1].error);
  } finally { f.cleanup(); }
});
test('work launch revalidates access after Default AI resolution and creates nothing on rejection', async function () {
  var f = fixture();
  try {
    var entry = await f.createDriverIssue({ title: 'Wait for runtime' });
    var release; var gate = new Promise(function (resolve) { release = resolve; });
    var start = attachWork({ sm: f.sm, resolveDefaultAi: function () { return gate; } });
    var pending = start(f.ws, { requestId: 'revoke', args: { ref: entry.ref, expectedRevision: 1 } }, f.bound);
    f.revoke(); release({ ready: true, vendor: 'codex' });
    await assert.rejects(pending, /valid/); assert.equal(f.sm.sessions.size, 0);
  } finally { f.cleanup(); }
});
test('work launch refuses concurrent issue revisions and reused identifiers for another issue', async function () {
  var f = fixture();
  try {
    var entry = await f.createDriverIssue({ title: 'Concurrent issue' });
    var release; var gate = new Promise(function (resolve) { release = resolve; });
    var start = attachWork({ sm: f.sm, resolveDefaultAi: function () { return gate; } });
    var pending = start(f.ws, { requestId: 'race', args: { ref: entry.ref, expectedRevision: 1 } }, f.bound);
    await f.bound.updateIssue({ ref: entry.ref, expectedRevision: 1, summary: 'New requirement' });
    release({ ready: true, vendor: 'codex' }); await assert.rejects(pending, /conflict/);
    assert.equal(f.sm.sessions.size, 0);
    await assert.rejects(start(f.ws, { requestId: 'race', args: { ref: 'issue:' + 'a'.repeat(24), expectedRevision: 1 } }, f.bound), /different arguments/);
  } finally { f.cleanup(); }
});
test('stdio and SDK tool descriptors bind to the same authorized Driver', async function () {
  var f = fixture();
  try {
    var session = f.sm.createSessionRaw({ ownerId: 'u1' });
    var descriptor = f.controller.createMcpServer({ createToolServer: function (definition) { return definition; } }, session);
    assert.equal(descriptor.name, 'clay-issues'); assert.equal(descriptor.tools.length, 9);
    var created = await f.controller.callBridgeTool(session, 'create_issue', { title: 'From bridge' });
    var ref = JSON.parse(created.content[0].text).ref;
    var reader = descriptor.tools.find(function (tool) { return tool.name === 'read_issue'; });
    var read = await reader.handler({ ref: ref }); assert.equal(JSON.parse(read.content[0].text).title, 'From bridge');
    f.revoke(); var denied = await reader.handler({ ref: ref }); assert.equal(denied.isError, true);
  } finally { f.cleanup(); }
});
test('members can comment, owners can tombstone, and stale or deleted mutations fail safely', async function () {
  var f = fixture();
  try {
    var entry = await f.createDriverIssue({ title: 'Discuss deletion' });
    var commented = f.bound.commentIssue({ ref: entry.ref, body: 'Please clarify the impact.' });
    assert.equal(commented.comments[0].author.userId, 'u1');
    assert.equal(commented.comments[0].status, 'pending');
    var memberBound = f.service.bindUser({ projectSlug: 'app', userId: f.member.id });
    assert.ok(memberBound);
    var memberComment = memberBound.commentIssue({ ref: entry.ref, body: 'Member context.' });
    assert.equal(memberComment.comments[1].author.userId, 'u2');
    assert.equal(memberComment.revision, entry.revision);
    assert.equal(memberBound.canDelete, false);
    assert.throws(function () { memberBound.removeIssue({ ref: entry.ref, expectedRevision: entry.revision }); }, /project owner/);
    var driverSession = f.sm.createSessionRaw({ ownerId: 'u1' });
    var feedbackTool = f.controller.getDynamicToolDefs(driverSession).find(function (tool) { return tool.name === 'list_issue_feedback'; });
    var feedback = JSON.parse((await feedbackTool.handler({})).content[0].text);
    assert.equal(feedback.total, 2);
    var reviewTool = f.controller.getDynamicToolDefs(driverSession).find(function (tool) { return tool.name === 'review_issue_comment'; });
    var reviewed = JSON.parse((await reviewTool.handler({ ref: entry.ref, commentId: feedback.feedback[0].commentId, action: 'clarify', response: 'Please add the reproduction step.' })).content[0].text);
    assert.equal(reviewed.comments[0].status, 'clarification-needed');
    assert.throws(function () { f.bound.removeIssue({ ref: entry.ref, expectedRevision: 0 }); }, /conflict/);
    var deleted = f.bound.removeIssue({ ref: entry.ref, expectedRevision: entry.revision });
    assert.equal(deleted.deleted, true);
    assert.equal(f.bound.listIssues({}).total, 0);
    assert.throws(function () { f.bound.readIssue({ ref: entry.ref }); }, /not found/);
    assert.throws(function () { f.bound.commentIssue({ ref: entry.ref, body: 'After deletion' }); }, /not found/);
    assert.equal(f.bound.issueHistory({ ref: entry.ref }).deleted, true);
  } finally { f.cleanup(); }
});
test('Driver feedback scans beyond the first page and incorporates atomically', async function () {
  var f = fixture();
  try {
    var last;
    for (var i = 0; i < 21; i++) last = await f.createDriverIssue({ title: 'Issue ' + i });
    var memberBound = f.service.bindUser({ projectSlug: 'app', userId: f.member.id });
    var commented = memberBound.commentIssue({ ref: last.ref, body: 'Please include the repro.' });
    var driverSession = f.sm.createSessionRaw({ ownerId: 'u1' });
    var tools = f.controller.getDynamicToolDefs(driverSession);
    var feedbackTool = tools.find(function (tool) { return tool.name === 'list_issue_feedback'; });
    var feedback = JSON.parse((await feedbackTool.handler({})).content[0].text);
    assert.equal(feedback.total, 1);
    assert.equal(feedback.feedback[0].ref, last.ref);
    var reviewTool = tools.find(function (tool) { return tool.name === 'review_issue_comment'; });
    var incorporated = JSON.parse((await reviewTool.handler({ ref: last.ref, commentId: commented.comments[0].id, action: 'incorporate', expectedRevision: 1, summary: 'Reproduction captured', response: 'Added to the issue.' })).content[0].text);
    assert.equal(incorporated.revision, 2);
    assert.equal(incorporated.summary, 'Reproduction captured');
    assert.equal(incorporated.comments[0].status, 'incorporated');
  } finally { f.cleanup(); }
});
test('Driver feedback exposes a cursor for issues beyond its bounded scan', async function () {
  var f = fixture();
  try {
    var first = await f.createDriverIssue({ title: 'Paged issue 0' });
    await new Promise(function (resolve) { setTimeout(resolve, 10); });
    for (var i = 1; i < 501; i++) await f.createDriverIssue({ title: 'Paged issue ' + i });
    f.bound.commentIssue({ ref: first.ref, body: 'At the beginning of the issue board.' });
    var session = f.sm.createSessionRaw({ ownerId: 'u1' });
    var tool = f.controller.getDynamicToolDefs(session).find(function (item) { return item.name === 'list_issue_feedback'; });
    var cursor = null; var pages = 0; var found = false; var firstPage = true;
    do {
      var page = JSON.parse((await tool.handler(Object.assign({ limit: 1 }, cursor ? { cursor: cursor } : {}))).content[0].text);
      pages++;
      if (firstPage) { assert.equal(page.feedback.length, 0); assert.ok(page.nextCursor); firstPage = false; }
      if (page.feedback.some(function (item) { return item.ref === first.ref; })) found = true;
      cursor = page.nextCursor;
    } while (cursor && pages < 20);
    assert.equal(found, true);
    assert.ok(pages > 1);
  } finally { f.cleanup(); }
});
test('Driver feedback cursor advances through comments without repeating issue pages', async function () {
  var f = fixture();
  try {
    var first = await f.createDriverIssue({ title: 'First feedback issue' });
    var second = await f.createDriverIssue({ title: 'Second feedback issue' });
    f.bound.commentIssue({ ref: first.ref, body: 'First one.' });
    f.bound.commentIssue({ ref: first.ref, body: 'First two.' });
    f.bound.commentIssue({ ref: second.ref, body: 'Second one.' });
    f.bound.commentIssue({ ref: second.ref, body: 'Second two.' });
    var session = f.sm.createSessionRaw({ ownerId: 'u1' });
    var tool = f.controller.getDynamicToolDefs(session).find(function (item) { return item.name === 'list_issue_feedback'; });
    var cursor = null; var pages = 0; var ids = [];
    do {
      var args = { limit: 1 }; if (cursor) args.cursor = cursor;
      var page = JSON.parse((await tool.handler(args)).content[0].text);
      pages++; ids = ids.concat(page.feedback.map(function (item) { return item.commentId; })); cursor = page.nextCursor;
      assert.ok(pages < 10, 'feedback pagination must terminate');
    } while (cursor);
    assert.equal(ids.length, 4);
    assert.equal(new Set(ids).size, 4);
  } finally { f.cleanup(); }
});
test('a runtime that fails to accept the initial message reports failure and preserves linked history', async function () {
  var f = fixture();
  try {
    var entry = await f.createDriverIssue({ title: 'Runtime unavailable' });
    var start = attachWork({ sm: f.sm, resolveDefaultAi: async function () { return { ready: true, vendor: 'codex', model: 'test' }; }, getSdk: function () { return { startQuery: async function () {} }; }, onProcessingChanged: function () {} });
    await assert.rejects(start(f.ws, { requestId: 'failed-runtime', args: { ref: entry.ref, expectedRevision: 1 } }, f.bound), /could not start/);
    var latest = f.bound.readIssue({ ref: entry.ref }); assert.equal(latest.status, 'in_progress'); assert.equal(latest.linkedWorkSessions.length, 1);
    var session = f.sm.sessions.values().next().value; assert.equal(session.isProcessing, false); assert.ok(session.history.some(function (item) { return item.type === 'error'; }));
  } finally { f.cleanup(); }
});
