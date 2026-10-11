var test = require('node:test');
var assert = require('node:assert/strict');
var policy = require('../scripts/release-v5-policy');
var config = require('../release.config');

test('release policy allows v5 stable and beta but refuses another major', function () {
  ['5.0.2', '5.2.0-beta.1'].forEach(function (version) {
    assert.doesNotThrow(function () { policy.verifyRelease({}, { nextRelease: { version: version } }); });
  });
  ['6.0.0-beta.2', '6.0.0', '4.9.0', undefined].forEach(function (version) {
    assert.throws(function () { policy.verifyRelease({}, { nextRelease: { version: version } }); }, /must stay on v5/);
  });
});

test('breaking settings changes produce a v5 minor while fixes retain patch releases', async function () {
  var analyzer = await import('@semantic-release/commit-analyzer');
  var options = config.plugins[0][1];
  var context = { cwd: process.cwd(), logger: { log: function () {} } };
  var breaking = await analyzer.analyzeCommits(options, Object.assign({}, context, { commits: [{ hash: 'a', message: 'feat(settings)!: update groups\n\nBREAKING CHANGE: Group policy changed.' }] }));
  var fix = await analyzer.analyzeCommits(options, Object.assign({}, context, { commits: [{ hash: 'b', message: 'fix(storage): improve scanning' }] }));
  assert.equal(breaking, 'minor');
  assert.equal(fix, 'patch');
  assert.ok(config.plugins.indexOf('./scripts/release-v5-policy.js') < config.plugins.indexOf('@semantic-release/npm'));
});
