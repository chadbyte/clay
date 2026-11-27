var crypto = require('crypto');
var userInput = require('./yoke/user-input');
var actions = require('./mcp-management-service').ACTIONS;
var TTL = 10 * 60 * 1000;
function result(value, error) { return { content: [{ type: 'text', text: JSON.stringify(value) }], isError: !!error }; }
function attachManagementTools(ctx) {
  var sessions = new WeakMap(), active = new Set(), closed = false;
  function state(session, generation) {
    var value = sessions.get(session);
    if (!value || value.generation !== generation) { value = { generation: generation, receipts: new Map() }; sessions.set(session, value); }
    value.receipts.forEach(function (entry, key) { if (entry.expires <= Date.now()) value.receipts.delete(key); });
    return value;
  }
  function definitions(session, owner, generation, authorize) {
    var sourceOrigin = session.sessionOriginId || null;
    if (session.spawn || session.delegated || session._delegatedBy || session._pairDelegation || session.sessionProvenance && session.sessionProvenance.kind === 'worker') return [];
    function check() {
      authorize();
      if ((session.sessionOriginId || null) !== sourceOrigin) throw new Error('MCP source conversation changed.');
      if (closed || session.spawn || session.delegated || session._delegatedBy || session._pairDelegation || session._mentionInProgress || session.homeDebatePlanning || session.sessionProvenance && session.sessionProvenance.kind === 'worker') throw new Error('MCP management requires a direct owner-private agent conversation.');
    }
    function receipt(id) {
      var entry = state(session, generation).receipts.get(id);
      if (!entry) throw new Error('MCP review receipt expired or belongs to another query. Inspect a new change; do not replay an uncertain effect.');
      return entry;
    }
    async function read(args) {
      check();
      if (args.changeId !== undefined) {
        if (Object.keys(args).length !== 1) throw new Error('Read a change receipt by changeId only.');
        var entry = receipt(args.changeId);
        return result({ changeId: args.changeId, status: entry.status, result: entry.output || null, expiresAt: entry.expires, lifetime: 'Source query only, at most ten minutes; no durable retry after restart.' });
      }
      return result(await ctx.service.read(owner, args, check));
    }
    function inspect(args) {
      check(); var current = state(session, generation);
      if (current.receipts.size >= 100) throw new Error('This query reached the MCP review limit. Read existing receipts before continuing.');
      var plan = ctx.service.prepare(owner, args, session, check), id = 'mcp-change-' + crypto.randomUUID();
      var entry = { plan: plan, status: 'inspected', expires: Date.now() + TTL };
      current.receipts.set(id, entry);
      return result({ status: 'inspected', changeId: id, review: plan.review, expiresAt: entry.expires, applied: false });
    }
    async function apply(args) {
      check();
      if (Object.keys(args).length !== 1 || typeof args.changeId !== 'string') throw new Error('Pass only the exact changeId. Agent-provided approval is never accepted.');
      var entry = receipt(args.changeId);
      if (entry.status !== 'inspected') return result({ changeId: args.changeId, status: entry.status, result: entry.output || null, replayed: false });
      if (!ctx.humans(session, owner) || session.loop && session.loop.active && session.loop.role !== 'crafting') return result({ status: 'consent_unavailable', applied: false, message: 'The authenticated owner must open this conversation to review the exact MCP change.' });
      var controller = new AbortController(), reviewer = null, timer, expired = false;
      var sourceSignal = session.abortController && session.abortController.signal;
      function stopped() { controller.abort(); }
      function live() { check(); if (controller.signal.aborted || Date.now() >= entry.expires || !reviewer || !ctx.canRespond(reviewer, session, owner)) throw new Error('MCP review stopped, expired or owner disconnected.'); }
      entry.status = 'reviewing'; active.add(controller);
      if (sourceSignal) sourceSignal.addEventListener('abort', stopped, { once: true });
      try {
        timer = setTimeout(function () { expired = true; controller.abort(); }, Math.min(ctx.consentTimeout || 45000, 45000));
        var handler = ctx.userInput && ctx.userInput(session);
        var answer = await userInput.dispatchUserInput(function (request, respond) {
          request.authorizeResponse = function (ws) {
            try { check(); if (controller.signal.aborted || entry.status !== 'reviewing' || !ctx.canRespond(ws, session, owner)) return false; reviewer = ws; return true; } catch (error) { return false; }
          };
          if (typeof handler !== 'function') return respond.cancel('Owner review is unavailable.');
          return handler(request, respond);
        }, { questions: [{ id: 'mcp_change', header: 'MCP change', question: entry.plan.review, allowOther: false, options: [{ label: 'Keep unchanged' }, { label: 'Apply this MCP change' }] }] }, { source: 'product-control', requestId: 'mcp_change_' + crypto.randomUUID(), signal: controller.signal });
        clearTimeout(timer);
        if (answer.status !== 'submitted' || !answer.answers.mcp_change || answer.answers.mcp_change.length !== 1 || answer.answers.mcp_change[0] !== 'Apply this MCP change') {
          entry.status = expired ? 'expired' : answer.status === 'submitted' ? 'declined' : answer.status;
          return result({ status: entry.status, applied: false, changeId: args.changeId });
        }
        live();
        if (ctx.service.version(owner) !== entry.plan.version) throw new Error('MCP connections changed. Inspect a new change.');
        entry.plan.validate();
        timer = setTimeout(stopped, Math.max(1, entry.expires - Date.now()));
        entry.status = 'queued';
        entry.output = await entry.plan.execute(reviewer, controller.signal, function () { entry.status = 'started'; });
        live(); entry.status = entry.output.status;
        return result(Object.assign({ changeId: args.changeId }, entry.output));
      } catch (error) {
        entry.output = { message: error.message, inspectBeforeRetry: true };
        entry.status = entry.status === 'started' ? 'unknown' : 'refused';
        return result({ status: entry.status, changeId: args.changeId, result: entry.output }, true);
      } finally {
        function cleanup() { clearTimeout(timer); active.delete(controller); if (sourceSignal) sourceSignal.removeEventListener('abort', stopped); }
        if (entry.status === 'sign_in_started' && !controller.signal.aborted) controller.signal.addEventListener('abort', cleanup, { once: true });
        else cleanup();
      }
    }
    function wrap(handler) { return function (args) { return Promise.resolve().then(function () { return handler(args || {}); }).catch(function (error) { return result({ status: 'refused', message: error.message }, true); }); }; }
    return [
      { name: 'read_mcp_connections', description: 'Read your own Local, Remote and Client MCP connections, paginated tool details, or an exact change receipt. checkXcode performs a bounded read-only host readiness check. Never returns stored credentials. Read humanSteps for setup that still needs a person.', inputSchema: { type: 'object', properties: { id: { type: 'string' }, changeId: { type: 'string' }, checkXcode: { type: 'boolean' }, offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 100 } }, additionalProperties: false }, handler: wrap(read) },
      { name: 'inspect_mcp_connection_change', description: 'Prepare one exact MCP setup/change for authenticated owner review without applying it. Supports local/remote add, enable/disable, test, rename/remove, private browser sign-in, Xcode connect/disconnect, Client MCP toggles/setup and opening secure credential/token/permission forms. Never put credentials in arguments, URLs or chat. Use existing import discovery/proposal tools for vendor import.', inputSchema: { type: 'object', properties: { action: { type: 'string', enum: actions }, id: { type: 'string' }, label: { type: 'string', maxLength: 100 }, command: { type: 'string', maxLength: 4096 }, args: { type: 'array', items: { type: 'string' }, maxItems: 100 }, cwd: { type: 'string', maxLength: 4096 }, url: { type: 'string', maxLength: 4096 } }, required: ['action'], additionalProperties: false }, handler: wrap(inspect) },
      { name: 'apply_mcp_connection_change', description: 'Show the exact prepared MCP change to the authenticated owner and apply only after that owner approves. Pass only changeId; model approval flags and delegated answers are rejected. Receipts last at most ten minutes in this source query; repeating an ID reads its status and never replays an effect. Stop cancels further work; unknown outcomes require inspection. Opening a form is not credential persistence; starting sign-in is not authentication.', inputSchema: { type: 'object', properties: { changeId: { type: 'string' } }, required: ['changeId'], additionalProperties: false }, handler: wrap(apply) },
    ];
  }
  return { definitions: definitions, destroy: function () { closed = true; active.forEach(function (controller) { controller.abort(); }); active.clear(); sessions = new WeakMap(); } };
}
module.exports = { attachManagementTools: attachManagementTools };
