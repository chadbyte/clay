// Synthetic native resources behind the production task service. No providers run.
var readers = require('../../lib/yoke/claude-task-reader'), tasks = require('../../lib/project-background-tasks');
var versions = new Map();
function handle(url, req, res, sm) {
  if (url.pathname !== '/fixture/background-tasks') return false;
  var session = sm.sessions.get(Number(url.searchParams.get('id')));
  if (!session) { res.writeHead(404); res.end(); return true; }
  var info = versions.get(session.localId);
  if (!info) {
    info = { version: 1, stopped: [] }; versions.set(session.localId, info);
    var nativeTasks = [{ task_id: 'agent-a', task_type: 'local_agent', description: 'Review authentication', run_id: 'run-1' },
      { task_id: 'shell-a', task_type: 'local_bash', description: 'Run checks', run_id: 'run-1' },
      { task_id: 'ambient-a', task_type: 'local_bash', description: 'Housekeeping watcher', run_id: 'run-1', ambient: true }];
    var sdk = { listSubagents: async function () { return ['agent-a']; }, getSubagentMessages: async function (parent, id, options) {
      var all = [{ type: 'user', message: { content: 'Review this code' } }];
      for (var i = 0; i < 105; i++) all.push({ type: 'assistant', message: { content: [{ type: 'text', text: 'Task transcript ' + info.version + ' row ' + i },
        { type: 'tool_use', id: 'tool-' + i, name: 'Read', input: { file_path: 'fixture.txt' } }, { type: 'tool_result', tool_use_id: 'tool-' + i, content: 'Task file content' }] } });
      return all.slice(options.offset, options.offset + options.limit);
    } };
    var query = { getTaskOutput: async function () { return { output: 'Native shell output ' + info.version, truncated: true }; },
      stopTask: async function (id) { info.stopped.push(id); nativeTasks = nativeTasks.filter(function (task) { return task.task_id !== id; }); publish(); } };
    var reader = readers.createReader(async function () { return sdk; }, function () { return session.queryInstance === query ? query : null; }, '/fixture');
    query.readBackgroundTask = reader.read; session.queryInstance = query; session._sdkQueryGeneration = 1;
    function publish() {
      reader.observe({ type: 'system', subtype: 'background_tasks_changed', session_id: 'parent-fixture', tasks: nativeTasks });
      session.activeBackgroundTasks = nativeTasks.map(function (task) { return Object.assign({}, task, { task_type: task.task_type === 'local_agent' ? 'agent' : 'shell' }); });
      var catalog = tasks.remember(session, session.activeBackgroundTasks);
      sm.sendToSession(session, { type: 'active_background_tasks', tasks: session.activeBackgroundTasks, catalog: catalog });
    }
    info.publish = publish; publish();
  } else if (req.method === 'POST') { info.version++; info.publish(); session.taskIdMap = { 'task-tool': 'agent-a' }; tasks.observeMessage(session, { messageRole: 'assistant', parentToolUseId: 'task-tool', uuid: 'native-message-' + info.version, content: [{ type: 'text', text: 'Background preview **' + info.version + '**' }] }, sm.sendToSession); }
  res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ version: info.version, stopped: info.stopped })); return true;
}
module.exports = { handle: handle };
