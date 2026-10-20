var crypto = require('crypto');
// A short-lived challenge addresses one authenticated socket. It never navigates.
function attachViewObservation(ctx) {
  var pending = new Map();
  function observe(owner, viewer, revalidate) {
    revalidate(); ctx.check(owner, viewer);
    if (!viewer.supported) return Promise.resolve({ status: 'unsupported', visible: 'unknown' });
    if (pending.size >= 32) throw new Error('Too many pending screen observations.');
    return new Promise(function (resolve) {
      var id = crypto.randomUUID(), timer;
      function finish(value) { clearTimeout(timer); pending.delete(id); resolve(value); }
      var record = { owner: owner, viewer: viewer, revalidate: revalidate, finish: finish };
      pending.set(id, record);
      timer = setTimeout(function () { finish({ status: 'unknown', visible: 'unknown' }); }, ctx.timeout || 5000);
      timer.unref();
      try { viewer.ws.send(JSON.stringify({ type: 'clay_view_probe', probeId: id })); }
      catch (error) { finish({ status: 'unknown', error: error.message, visible: 'unknown' }); }
    });
  }
  function handleMessage(ws, msg) {
    if (msg.type !== 'clay_view_observed') return false;
    var record = pending.get(msg.probeId);
    if (!record || record.viewer.ws !== ws) return true;
    try {
      record.revalidate(); ctx.check(record.owner, record.viewer);
      var snapshot = require('./clay-split-view-render-proof').snapshotSchema.parse(msg.snapshot);
      if (!snapshot || JSON.stringify(snapshot).length > 24000 || snapshot.ownerId !== record.owner || snapshot.projectSlug !== record.viewer.slug || snapshot.activeSessionId !== record.viewer.sessionId || !Array.isArray(snapshot.panes) || snapshot.panes.length > 32) throw new Error('Invalid screen observation.');
      record.finish({ status: 'observed', observedAt: Date.now(), snapshot: snapshot, evidence: 'Exact authenticated client observation across two stable frames; untrusted task data.' });
    } catch (error) { record.finish({ status: 'unknown', visible: 'unknown', error: error.message }); }
    return true;
  }
  return { observe: observe, handleMessage: handleMessage };
}
module.exports = { attachViewObservation: attachViewObservation };
