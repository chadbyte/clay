var crypto = require('crypto');
function createSettingsNavigation(ctx) {
  var pending = new Map(), closed = false;
  function open(owner, ws, screen, id, session, authorize, signal) {
    authorize();
    if (closed || pending.size >= 100) throw new Error('MCP settings navigation is unavailable.');
    return new Promise(function (resolve, reject) {
      var requestId = 'mcp-settings-' + crypto.randomUUID(), timer;
      function finish(error, value) {
        if (!pending.has(requestId)) return;
        pending.delete(requestId); clearTimeout(timer); signal.removeEventListener('abort', stopped);
        if (error) reject(error); else resolve(value);
      }
      function stopped() { finish(new Error('MCP settings request stopped. It may already have reached the interface; inspect before retrying.')); }
      pending.set(requestId, { ws: ws, owner: owner, session: session, authorize: authorize, finish: finish });
      timer = setTimeout(function () { finish(null, { status: 'delivered', acknowledged: false, message: 'Request sent to the owner interface; client acceptance and visible rendering are unconfirmed. Open MCP / Skills in the source project to continue.' }); }, 5000);
      signal.addEventListener('abort', stopped, { once: true });
      try {
        authorize(); if (signal.aborted) return stopped();
        ctx.sendTo(ws, { type: 'mcp_settings_request', requestId: requestId, slug: ctx.slug, sessionId: session.localId, screen: screen, connectionId: id || null });
      } catch (error) { finish(error); }
    });
  }
  function handle(ws, msg) {
    if (msg.type !== 'mcp_settings_result') return false;
    var entry = pending.get(msg.requestId);
    if (!entry || entry.ws !== ws || msg.slug !== ctx.slug || msg.sessionId !== entry.session.localId) return true;
    try { entry.authorize(); entry.finish(null, { status: msg.accepted === true ? 'client_accepted' : 'client_refused', acknowledged: true, rendered: 'unconfirmed', message: msg.accepted === true ? 'Client accepted the settings request. Secret entry and saving remain human actions.' : 'The interface context changed or the connection is not loaded. Open MCP / Skills in the source conversation.' }); }
    catch (error) { entry.finish(error); }
    return true;
  }
  return { open: open, handle: handle, destroy: function () { closed = true; pending.forEach(function (entry) { entry.finish(new Error('MCP settings navigation closed.')); }); pending.clear(); } };
}
module.exports = { createSettingsNavigation: createSettingsNavigation };
