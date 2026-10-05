// Browser-lifetime activity history stays private to the authorized session owner.
function recordActivity(record, activity) {
  var history = record.activityHistory || (record.activityHistory = []);
  var previous = history[history.length - 1];
  var id = String(record.epoch) + ':' + String(activity.id);
  var entry = { id: id, text: activity.text, phase: activity.phase };
  if (previous && previous.id === id) history[history.length - 1] = entry;
  else { history.push(entry); if (history.length > 500) history.shift(); }
  record.activity = activity;
}
function interruptActivity(record) {
  if (record.activity && record.activity.phase === 'running') {
    recordActivity(record, Object.assign({}, record.activity, { phase: 'interrupted' }));
  }
  record.activity = null;
}
module.exports = { recordActivity: recordActivity, interruptActivity: interruptActivity };
