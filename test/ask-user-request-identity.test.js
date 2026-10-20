var test = require('node:test');
var assert = require('node:assert/strict');
var identity = require('../lib/ask-user-request-identity');
var normalize = require('../lib/yoke/user-input').normalizeQuestions;
function input() { return { questions: [{ question: 'Choose?', options: [{ label: 'A' }, { label: 'B' }] }] }; }
function event(value) { return { type: 'tool_executing', name: 'AskUserQuestion', id: 'exact-call', input: value }; }
test('raw Claude and normalized questions share identity in either delivery order', function () {
  var raw = input(), normalized = { questions: normalize(raw) };
  assert.equal(identity.sameAskUserRequest(event(raw), 'exact-call', normalized), true);
  assert.equal(identity.sameAskUserRequest(event(normalized), 'exact-call', raw), true);
  assert.equal(identity.sameAskUserRequest(event(raw), 'another-call', normalized), false);
});
test('changed questions, choices, flags and exact review targets never collapse', function () {
  [function (value) { value.questions[0].question = 'Different?'; },
    function (value) { value.questions[0].options[0].label = 'Different'; },
    function (value) { value.questions[0].required = false; },
    function (value) { value.questions[0].review = { revision: 2 }; },
    function (value) { value.questions[0].options[0].markdown = 'Different evidence'; }].forEach(function (change) {
      var raw = input(), next = input(); change(next);
      assert.equal(identity.sameAskUserRequest(event(raw), 'exact-call', next), false);
    });
});
test('legacy invalid schemas retain exact comparison rather than acquiring defaults', function () {
  var legacy = { questions: [{ question: 'Legacy?', options: [{ label: 'Only' }] }] };
  assert.equal(identity.sameAskUserRequest(event(legacy), 'exact-call', legacy), true);
  assert.equal(identity.sameAskUserRequest(event(legacy), 'exact-call', input()), false);
});
