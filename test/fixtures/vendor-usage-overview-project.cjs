// Isolated production coordinator fixture: no provider query, vendor login or network.
var assert = require('node:assert/strict');
var fs = require('fs');
var path = require('path');
var createProject = require('../../lib/project').createProjectContext;
async function main() {
  var root = process.argv[2], dir = path.join(root, 'project');
  fs.mkdirSync(dir);
  var scheduler = require('../../lib/durable-scheduler').attachDurableScheduler({ namespace: 'vendor-usage-fixture', storageDir: path.join(root, 'scheduler') });
  var project = createProject({ durableScheduler: scheduler, cwd: dir, slug: 'alpha', port: 0, notificationsModule: require('../../lib/project-notifications').attachNotifications({}) });
  var received = [];
  var ws = { readyState: 1, send: function (value) { received.push(JSON.parse(value)); } };
  project.clients.add(ws);
  function last(type) { for (var i = received.length - 1; i >= 0; i--) if (received[i].type === type) return received[i]; return null; }
  try {
    // A request through the real project message router.
    project.handleMessage(ws, { type: 'vendor_usage_get', slug: 'alpha', requestId: 'r1' });
    var first = last('vendor_usage_overview');
    assert.equal(first.requestId, 'r1');
    assert.equal(first.slug, 'alpha');
    var codex = first.vendors.filter(function (v) { return v.vendor === 'codex'; })[0];
    assert.deepEqual(codex.windows, []);
    assert.equal(codex.lastObservedAtMs, null);
    // A Codex session that is NOT the one the socket is viewing reports quota
    // through the real session manager's observation hook.
    var session = { localId: 4242, vendor: 'codex', ownerId: null, mode: 'gui', history: [], isProcessing: false };
    project.sm.sessions.set(4242, session);
    ws._clayActiveSession = 1;
    var resetsAt = Date.now() + 3600000;
    project.sm.notifyQuotaObserved(session, { type: 'rate_limit_usage', vendor: 'codex', source: 'account_snapshot', limitId: 'codex',
      quotaWindows: [{ key: 'primary', windowDurationMins: 300, usedPercent: 37, resetsAt: resetsAt }] }, Date.now());
    var pushed = last('vendor_usage_overview');
    assert.notEqual(pushed, first, 'the owner socket received a push');
    var entry = pushed.vendors.filter(function (v) { return v.vendor === 'codex'; })[0];
    assert.equal(entry.windows[0].usedPercent, 37);
    assert.equal(entry.sourceSessionId, 4242);
    // The route refuses another project's request.
    project.handleMessage(ws, { type: 'vendor_usage_get', slug: 'beta', requestId: 'r2' });
    assert.match(last('vendor_usage_overview').error, /different project/);
    // A deleted source session stops contributing.
    project.sm.sessions.delete(4242);
    project.handleMessage(ws, { type: 'vendor_usage_get', slug: 'alpha', requestId: 'r3' });
    assert.deepEqual(last('vendor_usage_overview').vendors.filter(function (v) { return v.vendor === 'codex'; })[0].windows, []);
    console.log('vendor usage production routing passed');
  } finally { project.destroy(); await scheduler.shutdown(); }
}
main().then(function () { process.exit(0); }, function (error) { console.error(error.stack); process.exit(1); });
