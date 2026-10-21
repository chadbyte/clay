// Native task inspection stays inside the process and OS identity owning the query.
var crypto = require('crypto');
function validId(value) { return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,160}$/.test(value); }
function createReader(loadSdk, getQuery, dir) {
  var sessionId = null, tasks = new Map(), closed = false;
  function observe(event) {
    if (!event) return;
    if (event.session_id && !event.parent_tool_use_id) sessionId = event.session_id;
    if (event.type !== 'system') return;
    if (event.subtype === 'background_tasks_changed') {
      tasks.forEach(function (task) { task.active = false; });
      (event.tasks || []).slice(0, 128).forEach(function (task) {
        if (!validId(task.task_id)) return;
        var old = tasks.get(task.task_id);
        if (old && String(old.run_id || '') === String(task.run_id || '') && old.task_type === task.task_type) Object.assign(old, task, { active: true });
        else tasks.set(task.task_id, Object.assign({}, task, { active: true }));
      });
    }
    if (event.subtype === 'task_notification') {
      var old = tasks.get(event.task_id);
      if (old && (!event.run_id || old.run_id === event.run_id)) old.active = false;
    }
    while (tasks.size > 128) tasks.delete(tasks.keys().next().value);
  }
  async function read(input) {
    var task = tasks.get(input.taskId), query = getQuery(), parent = sessionId;
    if (closed || !query || !task || !validId(input.taskId) || String(task.run_id || '') !== String(input.runId || '')) throw new Error('Task binding is unavailable.');
    var offset = Number.isInteger(input.offset) && input.offset >= 0 && input.offset <= 10000 ? input.offset : 0;
    function current() { if (closed || query !== getQuery() || parent !== sessionId || tasks.get(input.taskId) !== task) throw new Error('Task binding changed.'); }
    var result;
    if (task.task_type === 'local_agent') {
      if (!parent || !dir) throw new Error('Task transcript is not ready.');
      var sdk = await loadSdk(); current();
      var agents = await sdk.listSubagents(parent, { dir: dir }); current();
      // Never guess a sibling agent from its name, ordering or filesystem path.
      if (agents.indexOf(task.task_id) < 0) throw new Error('Task transcript is not available yet.');
      var messages = await sdk.getSubagentMessages(parent, task.task_id, { dir: dir, offset: offset, limit: 101 }); current();
      result = { kind: 'agent', messages: projectMessages(messages.slice(0, 100), offset), offset: offset, hasMore: messages.length > 100, active: task.active };
    } else {
      if (typeof query.getTaskOutput !== 'function') throw new Error('This runtime does not expose task output.');
      var output = await query.getTaskOutput(task.task_id); current();
      result = { kind: 'shell', output: String(output.output || '').slice(-8192), truncated: !!output.truncated, active: task.active };
    }
    return result;
  }
  return { observe: observe, read: read, close: function () { closed = true; tasks.clear(); } };
}
function projectMessages(messages, offset) {
  var rows = [], budget = 180000;
  messages.forEach(function (message, index) {
    var content = message.message && message.message.content;
    if (typeof content === 'string') content = [{ type: 'text', text: content }];
    if (!Array.isArray(content)) return;
    content.slice(0, 100).forEach(function (block, blockIndex) {
      if (budget <= 0) return;
      var text, role = message.type === 'user' ? 'user' : 'assistant', type = block.type;
      if (type === 'text') text = block.text;
      else if (type === 'tool_use') { role = 'tool'; text = block.name + '\n' + JSON.stringify(block.input || {}); }
      else if (type === 'tool_result') { role = 'tool'; text = typeof block.content === 'string' ? block.content : JSON.stringify(block.content || []); }
      else return;
      if (typeof text !== 'string') return;
      text = text.slice(0, Math.min(16000, budget)); budget -= text.length;
      rows.push({ role: role, text: text, recordIndex: ((offset || 0) + index) * 100 + blockIndex, recordType: type, toolName: block.name, toolId: block.id || block.tool_use_id, isError: !!block.is_error });
    });
  });
  return rows;
}
function createRequests(worker) {
  var pending = new Map();
  function close() { pending.forEach(function (entry) { clearTimeout(entry.timer); entry.reject(new Error('Task connection closed.')); }); pending.clear(); }
  return {
    close: close,
    request: function (input) {
      if (pending.size >= 8) return Promise.reject(new Error('Task reader is busy.'));
      return new Promise(function (resolve, reject) {
        var id = crypto.randomUUID();
        var timer = setTimeout(function () { pending.delete(id); reject(new Error('Task read timed out.')); }, 15000);
        pending.set(id, { resolve: resolve, reject: reject, timer: timer });
        try { if (worker.send({ type: 'read_background_task', requestId: id, input: input }) !== true) throw new Error('Task connection closed.'); }
        catch (error) { pending.delete(id); clearTimeout(timer); reject(error); }
      });
    },
    receive: function (message) {
      var entry = pending.get(message.requestId); if (!entry) return;
      pending.delete(message.requestId); clearTimeout(entry.timer);
      if (message.error) entry.reject(new Error(message.error)); else entry.resolve(message.data);
    }
  };
}
async function respond(reader, message, send) {
  try { if (!reader) throw new Error('Task query is unavailable.'); var data = await reader.read(message.input || {}); send({ type: 'background_task_response', requestId: message.requestId, data: data }); }
  catch (error) { send({ type: 'background_task_response', requestId: message.requestId, error: error.message }); }
}
module.exports = { createReader: createReader, createRequests: createRequests, respond: respond, projectMessages: projectMessages };
