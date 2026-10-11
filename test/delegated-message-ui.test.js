var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var path = require('node:path');
var css = fs.readFileSync(path.join(__dirname, '../lib/public/css/worker-delegation.css'), 'utf8');
test('delegated briefs use neutral material and a single visible identity', function () {
  assert.match(css, /background: var\(--bg\)/);
  assert.match(css, /\.dm-bubble-header \{ display: none; \}/);
  assert.match(css, /overflow-wrap: anywhere/);
  assert.doesNotMatch(css, /gradient|--success/);
});
