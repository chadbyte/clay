var test = require('node:test');
var assert = require('node:assert/strict');
var primary = require('../lib/session-work-primary');
function world() {
  var session = { localId: 1, ownerId: 'owner', githubLinks: [
    { url: 'https://github.com/a/b/pull/1', kind: 'pr', number: 1 },
    { url: 'https://github.com/a/b/pull/2', kind: 'pr', number: 2 },
    { url: 'https://github.com/a/b/issues/1', kind: 'issue', number: 1 },
  ], linearLinks: [{ provider: 'linear', url: 'https://linear.app/a/issue/A-1', identifier: 'A-1' }] };
  var ctx = { sm: { sessions: new Map([[1, session]]), saveSessionFile: function () { return true; }, broadcastSessionList: function () {} },
    canAccess: function () { return true; }, canRefresh: function (ws, item) { return ws.owner === item.ownerId; }, sendTo: function (ws, result) { ws.result = result; } };
  return { ctx: ctx, session: session };
}
test('primary choices are independent, require linked items and roll back failed saves', function () {
  var w = world(), s = w.session;
  [s.githubLinks[0], s.githubLinks[2], s.linearLinks[0]].forEach(function (link) { primary.setPrimary(w.ctx.sm, s, link.url); });
  assert.deepEqual(s.workPrimary, { pr: s.githubLinks[0].url, issue: s.githubLinks[2].url, linear: s.linearLinks[0].url });
  assert.throws(function () { primary.setPrimary(w.ctx.sm, s, 'https://github.com/a/b/issues/999'); }, /already linked/);
  w.ctx.sm.saveSessionFile = function () { return false; };
  assert.throws(function () { primary.setPrimary(w.ctx.sm, s, s.githubLinks[1].url); }, /Could not save/);
  assert.equal(s.workPrimary.pr, s.githubLinks[0].url);
  assert.throws(function () { primary.guardUnlink(s, s.githubLinks[0].url); }, /user-selected/);
});
test('human selection rejects non-owners and revoked project access', function () {
  var w = world(), ws = { owner: 'other' }, msg = { type: 'session_work_primary_set', sessionId: 1, url: w.session.githubLinks[0].url, requestId: 'one' };
  primary.handleMessage(w.ctx, ws, msg, function () {});
  assert.match(ws.result.error, /Only the session owner/); assert.equal(w.session.workPrimary, undefined);
  ws.owner = 'owner'; primary.handleMessage(w.ctx, ws, msg, function () {});
  assert.equal(ws.result.workPrimary.pr, msg.url);
  w.ctx.canAccess = function () { return false; };
  msg.url = w.session.githubLinks[1].url; primary.handleMessage(w.ctx, ws, msg, function () {});
  assert.match(ws.result.error, /Only the session owner/); assert.notEqual(w.session.workPrimary.pr, msg.url);
});
test('AI selection requires exact human acceptance; cancellation, races and stop cannot change it', async function () {
  var w = world(), s = w.session, respond;
  w.ctx.userInput = function () { return function (request, reply) { respond = reply; }; };
  var task = primary.requestPrimary(w.ctx, s, s.githubLinks[0].url, function () {});
  assert.equal(s.workPrimary, undefined);
  respond({ primary: ['Keep current'] }); await assert.rejects(task, /not changed/);
  task = primary.requestPrimary(w.ctx, s, s.githubLinks[0].url, function () {});
  respond({ primary: ['Set primary'] }); await task;
  assert.equal(s.workPrimary.pr, s.githubLinks[0].url);
  task = primary.requestPrimary(w.ctx, s, s.githubLinks[1].url, function () {});
  primary.setPrimary(w.ctx.sm, s, s.githubLinks[1].url);
  respond({ primary: ['Set primary'] }); await assert.rejects(task, /changed/);
  s.abortController = new AbortController();
  task = primary.requestPrimary(w.ctx, s, s.githubLinks[0].url, function () {});
  s.abortController.abort(); await assert.rejects(task, /not changed/);
  assert.equal(s.workPrimary.pr, s.githubLinks[1].url);
});
test('saved primaries outrank later links for all three badge types and popover offers distinct choices', async function () {
  var w = world(), s = w.session;
  primary.setPrimary(w.ctx.sm, s, s.githubLinks[0].url);
  s.workPrimary.pr = s.workPrimary.pr.replace('/a/b/', '/A/B/');
  var ui = await import('../lib/public/modules/session-github.js');
  var popup = await import('../lib/public/modules/session-work-primary.js');
  var html = ui.githubWorkMarkup(s, false, false, true);
  var visible = html.split('data-github-links=')[0];
  assert.match(visible, /href="https:\/\/github.com\/a\/b\/pull\/1"/);
  assert.doesNotMatch(visible, /href="https:\/\/github.com\/a\/b\/pull\/2"/);
  assert.match(visible, /A-1/); assert.match(visible, /issues\/1/);
  html = popup.primaryWorkPopover(s.githubLinks.concat(s.linearLinks), s.workPrimary, 1, ui.githubWorkMarkup);
  assert.match(html, /Linear issues/); assert.match(html, /Pull requests/); assert.match(html, /GitHub issues/);
  assert.match(html, /aria-pressed="true" disabled><svg/);
});
