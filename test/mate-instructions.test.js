var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var os = require('node:os');
var path = require('node:path');
var handle = require('../lib/server-mate-instructions').handleMateInstructions;
var identity = require('../lib/mates-identity');
var markers = require('../lib/mates-prompts').ALL_SYSTEM_MARKERS;
test('owner-scoped prompt save preserves managed sections and rejects stale or invalid edits', function (t) {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clay-prompt-test-')); t.after(function () { fs.rmSync(dir, {recursive:true, force:true}); });
  var original = '# Identity\nYou are a thoughtful design partner. Ask precise questions and explain your decisions.';
  var suffix = '\n\n' + markers[0] + '\nManaged instructions remain here.\n';
  var file = path.join(dir, 'CLAUDE.md'); fs.writeFileSync(file, original + suffix);
  var mates = {buildMateCtx:function (id) { return {userId:id}; }, isMateIdFormat:function (id) { return id === 'mate_test'; }, getMate:function (ctx) { return ctx.userId === 'owner' ? {id:'mate_test'} : null; }, getMateDir:function () { return dir; }, extractIdentity:function (text) { return identity.extractIdentity(text, markers); }, backupIdentity:identity.backupIdentity, logIdentityChange:identity.logIdentityChange};
  var messages = []; var ws = {send:function (text) { messages.push(JSON.parse(text)); }};
  function request(type, data, user) { handle(mates, ws, Object.assign({type:type, mateId:'mate_test', requestId:'r'}, data), user || 'owner'); return messages[messages.length - 1]; }
  assert.equal(request('mate_instructions_get', {}, 'other').ok, false);
  assert.equal(request('mate_instructions_get', {mateId:'../other'}).ok, false);
  var read = request('mate_instructions_get'); assert.equal(read.content, original);
  var next = original + '\nKeep responses concise and practical.';
  var save = request('mate_instructions_set', {content:next, revision:read.revision});
  assert.equal(save.ok, true); assert.equal(fs.readFileSync(file, 'utf8'), next + suffix);
  assert.equal(fs.readFileSync(path.join(dir, 'knowledge/identity-backup.md'), 'utf8'), next);
  assert.equal(request('mate_instructions_set', {content:original, revision:read.revision}).conflict, true);
  assert.equal(request('mate_instructions_set', {content:'short', revision:save.revision}).ok, false);
  assert.equal(request('mate_instructions_set', {content:next + suffix, revision:save.revision}).ok, false);
  assert.equal(fs.readFileSync(file, 'utf8'), next + suffix);
});

test('prompt messages route from the project socket to the owner-scoped handler', function () {
  var project = fs.readFileSync(path.join(__dirname, '../lib/project.js'), 'utf8');
  assert.match(project, /msg.type === "mate_instructions_get" \|\| msg.type === "mate_instructions_set"/);
  var server = fs.readFileSync(path.join(__dirname, '../lib/server-mates.js'), 'utf8');
  assert.ok(server.indexOf('if (!ws._clayUser) return false') < server.indexOf('handleMateInstructions(mates, ws, msg, userId)'));
});
