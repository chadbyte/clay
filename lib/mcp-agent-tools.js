// Agent import consent is server-owned, owner-only, exact-query and single-use.
var crypto = require('crypto');
var userInput = require('./yoke/user-input');
var createProxy = require('./mcp-proxy').createProxy;
var SERVER = 'clay-mcp-connections';
function result(value, error) { return { content: [{ type: 'text', text: JSON.stringify(value) }], isError: !!error }; }
function attachMcpAgentTools(ctx) {
  var viewers = new Map(), pending = new Map(), used = new WeakMap(), closed = false;
  function ownerOf(session) { return ctx.isMultiUser() ? String(session.ownerId) : 'default'; }
  function authorized(session, owner, generation) {
    if (closed || !session || session.youCurator || session._mcpForeignInput || session.sessionVisibility === 'shared' || !ctx.canUseSession(session) || ownerOf(session) !== owner || Number(session._sdkQueryGeneration || 0) !== generation || session.taskStopRequested || session.abortController && session.abortController.signal.aborted) throw new Error('MCP management requires the current authorized private query.');
    ctx.authorizeOwner(owner);
  }
  function canRespond(ws, session, owner) {
    try {
      if (!ws || ws.readyState !== 1 || ctx.ownerFor(ws) !== owner) return false;
      return ctx.clients.has(ws) && ws._clayActiveSession === session.localId || viewers.has(ws) && viewers.get(ws).has(session);
    } catch (error) { return false; }
  }
  function humans(session, owner) {
    return Array.from(ctx.clients).concat(Array.from(viewers.keys())).some(function (ws) { return canRespond(ws, session, owner); });
  }
  function registerViewer(ws, session) {
    var owner = ownerOf(session);
    if (closed || !session || !ctx.canUseSession(session) || session._mcpForeignInput || session.sessionVisibility === 'shared') throw new Error('Consent viewer requires an authorized private session.');
    ctx.authorizeOwner(owner);
    if (ctx.ownerFor(ws) !== owner || ws.readyState !== 1) throw new Error('Consent viewer must be the authenticated owner.');
    var sessions = viewers.get(ws) || new Map(), detached = false;
    sessions.set(session, (sessions.get(session) || 0) + 1); viewers.set(ws, sessions);
    return function () {
      if (detached) return; detached = true;
      var count = sessions.get(session) || 0;
      if (count <= 1) sessions.delete(session); else sessions.set(session, count - 1);
      if (!sessions.size && viewers.get(ws) === sessions) viewers.delete(ws);
    };
  }
  function review(candidate, owner, config) {
    var restrictions = config.enabledTools === null ? 'Tool allowlist: unrestricted' : 'Tool allowlist: ' + JSON.stringify(config.enabledTools || []);
    restrictions += '\nExcluded tools: ' + JSON.stringify(config.disabledTools || []);
    if (config.toolPatterns && config.toolPatterns.length) restrictions += '\nExcluded vendor patterns: ' + JSON.stringify(config.toolPatterns);
    var question = 'Import "' + candidate.name + '" from ' + candidate.vendor + ' (' + candidate.scope + ') ?\nSource: ' + candidate.file + '\nTransport: ' + candidate.transport + '\nDependency: ' + candidate.dependency +
      '\nDestination: owner ' + owner + ' — private MCP catalog shared across your Clay sessions, project sessions and Mates; other accounts cannot use it.\n' + restrictions + '\nRequired credential names: ' + (candidate.references.join(', ') || 'None') +
      '\nThe imported copy will be DISABLED. This approval only saves that exact copy. Enable, Test and Sign in require separate actions. Original vendor files stay unchanged. Enter credentials only in MCP management, never in chat.';
    if (question.length > 2000) throw new Error('This candidate needs a larger policy review than the consent card supports. Review it in MCP management; no import was made.');
    return question;
  }
  function definitions(session) {
    var owner = ownerOf(session), generation = Number(session._sdkQueryGeneration || 0);
    function authorize() { authorized(session, owner, generation); }
    async function discover(args) {
      authorize();
      if (Object.keys(args).some(function (key) { return key !== 'vendor' && key !== 'file'; })) throw new Error('Unsupported discovery input.');
      if (!!args.file !== !!args.vendor) throw new Error('Configured discovery requires both vendor and absolute file path.');
      var scan = ctx.discovery.scan(owner, session, args.file ? { vendor: args.vendor, file: args.file } : null);
      authorize(); return result(Object.assign({ status: 'discovered', imported: false }, scan));
    }
    async function propose(args) {
      authorize();
      if (Object.keys(args).some(function (key) { return key !== 'scanId' && key !== 'candidateId'; })) throw new Error('Import approval cannot be supplied by an agent.');
      var selected = ctx.discovery.selected(owner, session, args);
      var key = JSON.stringify([owner, session.localId, generation, args.scanId, args.candidateId]);
      var attempts = used.get(session);
      if (!attempts || attempts.scanId !== args.scanId || attempts.generation !== generation) { attempts = { scanId: args.scanId, generation: generation, candidates: new Set() }; used.set(session, attempts); }
      if (attempts.candidates.has(args.candidateId) || pending.has(key)) throw new Error('This import proposal has already been requested. Scan again for a new review.');
      var candidate = ctx.discovery.candidate(owner, session, args);
      if (!humans(session, owner) || session.loop && session.loop.active && session.loop.role !== 'crafting') return result({ status: 'consent_unavailable', imported: false, message: 'An authenticated owner must open this conversation to approve an import. Scheduled or unattended runs cannot approve for the user.' });
      var question = review(candidate, owner, selected.config), requestId = 'mcp_import_' + crypto.randomUUID();
      var controller = new AbortController(), timer, timedOut = false, sessionSignal = session.abortController && session.abortController.signal;
      var entry = { controller: controller, requestId: requestId };
      pending.set(key, entry); attempts.candidates.add(args.candidateId);
      var parentAbort = function () { controller.abort(); };
      if (sessionSignal) sessionSignal.addEventListener('abort', parentAbort, { once: true });
      try {
        timer = setTimeout(function () { timedOut = true; controller.abort(); }, Math.min(ctx.consentTimeout || 45000, 45000));
        var handler = ctx.userInput && ctx.userInput(session);
        var answer = await userInput.dispatchUserInput(function (request, respond) {
          request.authorizeResponse = function (ws) {
            try { authorize(); return pending.get(key) === entry && canRespond(ws, session, owner); } catch (error) { return false; }
          };
          if (typeof handler !== 'function') return respond.cancel('Structured owner consent is unavailable.');
          return handler(request, respond);
        }, { questions: [{ id: 'mcp_import', header: 'Import MCP', question: question, allowOther: false, options: [{ label: 'Keep unchanged' }, { label: 'Import disabled copy' }] }] }, { source: 'mcp-import', requestId: requestId, signal: controller.signal });
        if (answer.status !== 'submitted' || !answer.answers.mcp_import || answer.answers.mcp_import.length !== 1 || answer.answers.mcp_import[0] !== 'Import disabled copy') return result({ status: timedOut ? 'expired' : answer.status === 'submitted' ? 'declined' : answer.status, imported: false, message: 'No connection was imported.' });
        authorize();
        if (pending.get(key) !== entry || !humans(session, owner)) throw new Error('Import consent is no longer available.');
        // Consume before entering the queue. Queued mutation revalidates everything again.
        pending.delete(key);
        function authorizeImport() { authorize(); if (controller.signal.aborted) throw new Error('Import consent expired before the copy could be saved. Scan again.'); }
        var id = await ctx.importConnection(owner, function () {
          authorizeImport();
          if (!humans(session, owner)) throw new Error('The owner disconnected before import.');
          var live = ctx.discovery.selected(owner, session, args);
          if (live.signature !== selected.signature || live.revision !== selected.revision) throw new Error('The reviewed candidate changed. Scan again.');
          return live;
        }, authorizeImport);
        return result({ status: 'imported', imported: true, id: id, enabled: false, label: candidate.name, message: 'Saved a disabled copy in your private catalog. Configure credentials in MCP management; activation, testing and login are separate actions.' });
      } finally {
        clearTimeout(timer); pending.delete(key);
        if (sessionSignal) sessionSignal.removeEventListener('abort', parentAbort);
      }
    }
    function wrap(handler) { return function (args) { return Promise.resolve().then(function () { return handler(args || {}); }).catch(function (error) { return result({ status: 'refused', imported: false, message: error.message }, true); }); }; }
    return [{ name: 'discover_mcp_connections', description: 'Read-only inspection of your vendor MCP sources. Returns redacted candidate IDs and provenance. Never executes commands, imports, activates, logs in or reads vendor OAuth stores. Use credential entry only in MCP management.', inputSchema: { type: 'object', properties: { vendor: { type: 'string' }, file: { type: 'string' } }, additionalProperties: false }, handler: wrap(discover) },
      { name: 'propose_mcp_import', description: 'Present one exact discovered candidate to the authenticated owner for structured approval, then save a disabled copy only after explicit approval. Denial, cancellation, timeout or absent owner causes no import. Pass only scanId and candidateId; agent-provided approval is never accepted.', inputSchema: { type: 'object', properties: { scanId: { type: 'string' }, candidateId: { type: 'string' } }, required: ['scanId', 'candidateId'], additionalProperties: false }, handler: wrap(propose) }];
  }
  function getServer(session) {
    try {
      authorized(session, ownerOf(session), Number(session._sdkQueryGeneration || 0));
      if (ctx.available && !ctx.available(session)) return null;
      var tools = definitions(session);
      return createProxy(SERVER, tools, function (name, args) { var tool = tools.find(function (item) { return item.name === name; }); return tool.handler(args); });
    } catch (error) { return null; }
  }
  function destroy() { closed = true; pending.forEach(function (entry) { entry.controller.abort(); }); pending.clear(); used = new WeakMap(); viewers.clear(); }
  return { getServer: getServer, registerViewer: registerViewer, destroy: destroy };
}
module.exports = { attachMcpAgentTools: attachMcpAgentTools, SERVER: SERVER };
