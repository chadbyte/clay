var createAdapter = require('../../lib/yoke/adapters/codex').createCodexAdapter;

function tick() { return new Promise(function(resolve) { setImmediate(resolve); }); }
async function until(check) {
  var deadline = Date.now() + 3000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('Condition did not settle');
    await new Promise(function(resolve) { setTimeout(resolve, 10); });
  }
}
function fixture(t, override) {
  var servers = [], nextThread = 0, nextTurn = 0;
  function createServer(options) {
    var server = { started: false, stopped: 0, calls: [], handlers: [], loaded: [], options: options };
    server.start = function() { server.started = true; return Promise.resolve(); };
    server.stop = function() { server.stopped++; server.started = false; };
    server.addHandler = function(fn) { var entry = { threadId: null, fn: fn }; server.handlers.push(entry); return entry; };
    server.removeHandler = function(entry) { server.handlers = server.handlers.filter(function(current) { return current !== entry; }); };
    server.notify = function() {};
    server.respond = function(id, response) { server.calls.push({ method: 'response', id: id, params: response }); };
    server.send = function(method, params) {
      server.calls.push({ method: method, params: params });
      if (override) { var result = override(server, method, params); if (result !== undefined) return result; }
      if (method === 'thread/start' || method === 'thread/resume') {
        var id = params.threadId || 'thread-' + (++nextThread);
        if (server.loaded.indexOf(id) === -1) server.loaded.push(id);
        return Promise.resolve({ thread: { id: id } });
      }
      if (method === 'thread/loaded/list') return Promise.resolve({ data: server.loaded.slice(), nextCursor: null });
      if (method === 'thread/unsubscribe') {
        server.loaded = server.loaded.filter(function(id) { return id !== params.threadId; });
        return Promise.resolve({ status: 'unsubscribed' });
      }
      if (method === 'turn/start') return Promise.resolve({ turn: { id: 'turn-' + (++nextTurn) } });
      return Promise.resolve({ data: [], nextCursor: null });
    };
    server.emit = function(method, params) {
      server.handlers.slice().forEach(function(entry) { if (!params.threadId || entry.threadId === params.threadId) entry.fn({ method: method, params: params }); });
    };
    server.complete = function(threadId) {
      var calls = server.calls.filter(function(call) { return call.method === 'turn/start' && call.params.threadId === threadId; });
      var all = servers.reduce(function(result, current) { return result.concat(current.calls.filter(function(call) { return call.method === 'turn/start'; })); }, []);
      var call = calls[calls.length - 1];
      server.emit('turn/completed', { threadId: threadId, turn: { id: 'turn-' + (all.indexOf(call) + 1), status: 'completed' } });
    };
    servers.push(server);
    return server;
  }
  var adapter = createAdapter({ cwd: process.cwd(), createAppServer: createServer, skillOptions: { disable: true } });
  t.after(function() { return adapter.shutdown(); });
  return { adapter: adapter, servers: servers,
    fresh: function(opts) { return adapter.createQuery(Object.assign({ model: 'gpt-test' }, opts)); },
    recover: function(opts) { return adapter.createQuery(Object.assign({ resumeSessionId: 'saved-thread',
      sessionMcpServer: { name: 'clay-session-tools', command: process.execPath, args: ['fixture-only.js'] },
    }, opts)); },
  };
}
module.exports = { fixture: fixture, tick: tick, until: until };
