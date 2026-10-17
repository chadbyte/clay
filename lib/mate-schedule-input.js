var rules = require('./schedule-rule');
function normalize(input, previous) {
  input = input || {};
  var message = input.message === undefined && previous ? previous.message : input.message;
  if (typeof message !== 'string' || !message.trim() || message.length > 1200 || message.indexOf('\u0000') >= 0) throw new Error('A message of 1 to 1200 characters is required.');
  var source = input.scheduleRule || (previous && previous.rule) || {
    version: 1, timezone: 'server-local', anchorDate: input.date, time: input.time, recurrence: null,
  };
  source = Object.assign({}, source);
  if (input.date !== undefined) source.anchorDate = input.date;
  if (input.time !== undefined) source.time = input.time;
  var checked = rules.validateScheduleRule(source);
  if (!checked.ok) throw new Error(checked.error);
  return { message: message.trim(), rule: checked.value };
}
function timezone() { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; }
function review(value) {
  var rule = value.rule;
  var repeat = rule.recurrence ? 'Every ' + rule.recurrence.every + ' ' + rule.recurrence.unit +
    (rule.recurrence.weekdays ? ' on ' + rule.recurrence.weekdays.map(function (day) { return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][day]; }).join(', ') : '') : 'Once';
  if (rule.recurrenceEnd) repeat += rule.recurrenceEnd.type === 'after' ? ', ' + rule.recurrenceEnd.count + ' deliveries' : ', through ' + rule.recurrenceEnd.date;
  if (rule.interval) {
    var ending = rule.interval.end;
    repeat += '; every ' + rule.interval.every + ' ' + rule.interval.unit;
    repeat += !ending ? ', until end of day' : ending.type === 'after' ? ', ' + ending.count + ' deliveries per day' : ', until ' + ending.time;
  }
  return value.message + '\n' + rule.anchorDate + ' at ' + rule.time + ' (' + timezone() + ')\n' + repeat;
}
module.exports = { normalize: normalize, timezone: timezone, review: review };
