var test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
var root = fs.mkdtempSync(path.join(os.tmpdir(), 'clay-snapshot-test-'));
process.env.HOME = root; process.env.CLAY_HOME = path.join(root, '.clay'); process.env.CLAY_CONFIG = path.join(root, 'config.json');
var snapshots = require('../lib/contextual-screen-snapshot'), createQueue = require('../lib/project-pending-message-queue').createPendingMessageQueue;
test.after(function () { fs.rmSync(root, { recursive: true, force: true }); });
function fixture() {
  var session = { localId: 3, ownerId: 'owner', sessionOriginId: 'origin' };
  var mate = { id: 'clay', builtinKey: 'clay', createdBy: 'owner', createdAt: 1 };
  var ctx = { slug: 'mate-clay', isMate: true, mateId: 'clay', getProjectOwnerId: function () { return 'owner'; }, sm: { sessions: new Map([[3, session]]) }, matesModule: { buildMateCtx: function () { return {}; }, getMate: function () { return mate; } }, usersModule: { isMultiUser: function () { return true; }, findUserById: function () { return { id: 'owner' }; }, canAccessSession: function () { return true; } }, getProjectAccess: function () { return {}; } };
  var message = { clientMessageId: 'snapshot-1', projectSlug: 'mate-clay', sessionId: 3, accountId: 'owner', sessionOriginId: 'origin', text: 'Actual request', contextualSnapshot: { version: 1, viewId: 'context-fixture', projectTitle: 'Alpha', conversationTitle: 'Selected', projectSlug: 'alpha', sessionId: 2, screen: 'Project' } };
  return { ctx: ctx, mate: mate, session: session, message: message, ws: { _clayUser: { id: 'owner' } }, service: snapshots.attachContextualScreenSnapshot(ctx) };
}
test('bounded snapshot schema rejects extra powers, missing fields, invalid kinds and oversized labels', function () {
  var valid = fixture().message.contextualSnapshot;
  assert.deepEqual(snapshots.validate(valid), valid);
  for (var change of [{ version: 2 }, { tool: 'shell' }, { constructor: 'bad' }, { toString: 'bad' }, { screen: 'Settings' }, { sessionId: -1 }, { projectTitle: 'x'.repeat(161) }, { conversationTitle: 'bad\nlabel' }, { viewId: '../target' }]) assert.throws(function () { snapshots.validate(Object.assign({}, valid, change)); });
  assert.throws(function () { snapshots.validate({ version: 1 }); });
  assert.match(snapshots.modelContext(valid), /viewer-supplied labels.*never permission/);
});
test('snapshot admission and asynchronous revalidation preserve exact private canonical owner delivery', function () {
  var f = fixture(), captured = f.service.capture(f.ws, f.session, f.message); captured.assertLive();
  f.mate.createdAt++; assert.throws(captured.assertLive, /source identity/);
  for (var flag of ['delegated', '_delegatedBy', '_pairDelegation', '_mcpForeignInput', '_mentionInProgress', 'homeDebatePlanning', 'debateSetupMode', 'mateCreationMode', 'hidden', 'destroying', 'spawn']) {
    var item = fixture(); item.session[flag] = true;
    assert.throws(function () { item.service.capture(item.ws, item.session, item.message); }, /private canonical/);
  }
  for (var kind of ['ordinary', 'deleted', 'foreign', 'origin', 'session', 'ownerRevoked', 'invalidMessageId']) {
    var item = fixture();
    if (kind === 'ordinary') item.mate.builtinKey = 'ward';
    if (kind === 'deleted') item.ctx.sm.sessions.delete(3);
    if (kind === 'foreign') item.ws._clayUser.id = 'foreign';
    if (kind === 'invalidMessageId') item.message.clientMessageId = 'x'.repeat(129);
    if (kind === 'origin') item.message.sessionOriginId = 'replaced';
    if (kind === 'session') item.message.sessionId = 4;
    if (kind === 'ownerRevoked') item.ctx.usersModule.findUserById = function () { return null; };
    assert.throws(function () { item.service.capture(item.ws, item.session, item.message); });
  }
});
test('durable pending queue preserves original snapshot and actual user pastes across reload and consumption', function () {
  var f = fixture(), options = { filePath: path.join(root, 'pending.json'), slug: 'mate-clay', send: function () {}, authorize: function () { return true; } };
  f.message.pastes = ['Actual user paste'];
  var queue = createQueue(options); assert.equal(queue.admit(f.session, f.message, f.ws._clayUser).ok, true);
  queue = createQueue(options);
  var item = queue.consumeOne(f.session, function (item, complete) { var capture = f.service.capture(f.ws, f.session, item.message); assert.deepEqual(capture.snapshot, f.message.contextualSnapshot); assert.deepEqual(item.message.pastes, ['Actual user paste']); complete(true); return true; });
  assert.ok(item);
});
