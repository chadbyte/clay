// Live recorded output only. Reading history or projecting a snapshot never stamps activity.
var crypto = require('crypto');
var provenance = require('./session-provenance');
var tools = { Bash: 'Running a command', Read: 'Reading files', Edit: 'Editing files', Write: 'Writing files',
  Grep: 'Searching files', Glob: 'Finding files', WebSearch: 'Searching the web', WebFetch: 'Reading a web page', Task: 'Delegating work' };
function summary(event) {
  if (!event) return null;
  if (event.type === 'delta' || event.type === 'assistant_message') return typeof event.text === 'string' && event.text.trim() ? 'Writing a reply' : null;
  if (event.type === 'thinking_delta') return typeof event.text === 'string' && event.text.trim() ? 'Thinking' : null;
  if (event.type === 'thinking_start') return 'Thinking';
  if (event.type === 'tool_start' || event.type === 'tool_executing') return Object.prototype.hasOwnProperty.call(tools, event.name) ? tools[event.name] : 'Using a tool';
  if (event.type === 'tool_result') return 'Tool result received';
  return null;
}
function observe(session, event) {
  if (!provenance.isWorker(session)) return;
  var label = summary(event); if (!label) return;
  var previous = session._workerActivity;
  session._workerActivity = { epoch: previous ? previous.epoch : crypto.randomUUID(), sequence: previous ? previous.sequence + 1 : 1,
    queryGeneration: Number(session._sdkQueryGeneration || 0), timestamp: Date.now(), summary: label };
}
function project(session) {
  var activity = session._workerActivity;
  return activity && activity.queryGeneration === Number(session._sdkQueryGeneration || 0) ? Object.assign({}, activity) : null;
}
module.exports = { observe: observe, project: project, summary: summary };
