var crypto = require('crypto');

// Visibility receipts observe existing workbench effects; they dispatch no product action.
function attachStudioPresentation(ctx) {
  var pending = new Map();
  function begin(session, action) {
    var display = ctx.getPresentation && ctx.getPresentation(session);
    if (!display) return null;
    var source = display.source(), observer = display.track('studio', action);
    if (!observer) return null;
    var id = crypto.randomUUID(), token = crypto.randomUUID(), record;
    function end(status, viewer) {
      if (!record || !pending.has(id)) return;
      pending.delete(id); clearTimeout(record.timer);
      if (viewer) observer.focus(viewer);
      observer.finish({ status: status });
    }
    function cancel() { if (record) { pending.delete(id); clearTimeout(record.timer); } observer.cancel(); }
    return {
      phase: observer.phase,
      guard: observer.guard,
      noVisibility: function () { observer.finish({ status: "render_unknown" }); },
      fail: function () { cancel(); },
      unknown: function () { observer.finish({ outcome: 'uncertain' }); },
      present: function (message, surface, key, revision, validate, send) {
        observer.guard();
        if (pending.size >= 100) { observer.finish({ status: 'render_unknown' }); return 0; }
        var target = { kind: 'surface', sourceSlug: source.sourceSlug, sourceSessionId: session.localId, sourceSessionOriginId: source.sourceSessionOriginId,
          runtimeId: source.runtimeId, surface: surface, key: key, revision: revision };
        observer.target(target, validate); observer.guard();
        var evidence = Object.assign({ version: 1, id: id, activityId: observer.id, token: token, deadline: Date.now() + 5000, target: target }, source);
        record = { session: session, source: source, evidence: evidence, observer: observer, viewers: new Set(), end: end, cancel: cancel };
        pending.set(id, record);
        record.timer = setTimeout(function () { end('render_unknown'); }, 5000); record.timer.unref();
        var sent = send(Object.assign({}, message, { controlPresentation: evidence }), function (ws) { record.viewers.add(ws); });
        if (sent > 0) { if (surface !== 'browser') observer.phase('delivered'); }
        else end('render_unknown');
        return sent;
      }
    };
  }
  function handleMessage(ws, msg) {
    if (msg.type !== 'clay_studio_rendered') return false;
    var record = pending.get(msg.id);
    if (!record || record.evidence.token !== msg.token || !record.viewers.has(ws)) return true;
    try {
      record.observer.guard();
      if (Date.now() > record.evidence.deadline) { record.end('render_unknown', ws); return true; }
      if (ws.readyState !== 1 || ws._clayAuthCheck && !ws._clayAuthCheck() ||
        ws._clayActiveSession !== record.session.localId || ctx.getSessionForWs(ws) !== record.session || (ws._clayUser && ws._clayUser.id || null) !== record.source.ownerId ||
        msg.sessionOriginId !== record.source.sourceSessionOriginId || msg.revision !== record.evidence.target.revision) throw new Error('Studio viewer or target changed.');
      record.end(msg.visible === true ? 'rendered' : 'render_unknown', ws);
    } catch (error) { record.cancel(); }
    return true;
  }
  return { begin: begin, handleMessage: handleMessage };
}
module.exports = { attachStudioPresentation: attachStudioPresentation };
