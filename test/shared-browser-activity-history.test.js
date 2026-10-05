var test = require('node:test');
var assert = require('node:assert/strict');
var history = require('../lib/shared-browser-activity-history');

test('activity completion updates its original caption and interruption preserves history', function () {
  var record = { epoch: 0 };
  history.recordActivity(record, { id: 1, text: 'I’ll open the form so we can try it.', phase: 'running' });
  history.recordActivity(record, { id: 1, text: 'I’ll open the form so we can try it.', phase: 'complete' });
  assert.equal(record.activityHistory.length, 1);
  assert.equal(record.activityHistory[0].phase, 'complete');
  history.recordActivity(record, { id: 2, text: 'I’ll check the submit button.', phase: 'running' });
  history.interruptActivity(record);
  assert.equal(record.activity, null);
  assert.equal(record.activityHistory.length, 2);
  assert.equal(record.activityHistory[1].phase, 'interrupted');
  record.epoch++;
  history.recordActivity(record, { id: 2, text: 'I’ll try the button again.', phase: 'running' });
  assert.equal(record.activityHistory.length, 3);
});

test('browser caption history retains the latest 500 actions without duplicating completion', function () {
  var record = { epoch: 0 };
  for (var i = 0; i < 510; i++) history.recordActivity(record, { id: i, text: 'Step ' + i, phase: 'running' });
  history.recordActivity(record, { id: 509, text: 'Step 509', phase: 'failed' });
  assert.equal(record.activityHistory.length, 500);
  assert.equal(record.activityHistory[0].id, '0:10');
  assert.equal(record.activityHistory[499].phase, 'failed');
});
