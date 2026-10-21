// Real SDK transcript parser against temporary files; no provider query or credentials.
var fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
var root = fs.mkdtempSync(path.join(os.tmpdir(), 'clay-task-sdk-'));
process.env.CLAUDE_CONFIG_DIR = root;
os.homedir = function () { return root; };
(async function () {
  try {
    var dir = path.join(root, 'project'); fs.mkdirSync(dir); dir = fs.realpathSync(dir);
    var session = '11111111-1111-4111-8111-111111111111';
    var project = path.join(root, 'projects', dir.replace(/[^a-zA-Z0-9]/g, '-'));
    var agents = path.join(project, session, 'subagents'); fs.mkdirSync(agents, { recursive: true });
    var user = { type: 'user', uuid: '22222222-2222-4222-8222-222222222222', parentUuid: null, sessionId: session, message: { role: 'user', content: 'Isolated task request' } };
    var assistant = { type: 'assistant', uuid: '33333333-3333-4333-8333-333333333333', parentUuid: user.uuid, sessionId: session, message: { role: 'assistant', content: [{ type: 'text', text: 'Isolated task response' }] } };
    fs.writeFileSync(path.join(project, session + '.jsonl'), JSON.stringify(Object.assign({}, user, { cwd: dir })) + '\n');
    fs.writeFileSync(path.join(agents, 'agent-task-a.jsonl'), JSON.stringify(user) + '\n' + JSON.stringify(assistant) + '\n');
    var sdk = await import('@anthropic-ai/claude-agent-sdk');
    var query = {}, reader = require('../../lib/yoke/claude-task-reader').createReader(async function () { return sdk; }, function () { return query; }, dir);
    reader.observe({ type: 'system', subtype: 'background_tasks_changed', session_id: session, tasks: [{ task_id: 'task-a', task_type: 'local_agent', run_id: 'run-a' }] });
    var result = await reader.read({ taskId: 'task-a', runId: 'run-a' });
    assert.deepEqual(result.messages.map(function (row) { return row.text; }), ['Isolated task request', 'Isolated task response']);
    assert.deepEqual((await reader.read({ taskId: 'task-a', runId: 'run-a', offset: 1 })).messages.map(function (row) { return row.text; }), ['Isolated task response']);
    console.log('Real SDK parent/agent transcript and pagination verified');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
})().catch(function (error) { console.error(error); process.exitCode = 1; });
