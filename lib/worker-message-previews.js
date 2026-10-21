// Bounded, exact-owner message previews use the Worker reader's existing authority.
function latest(history) {
  var found = null;
  for (var i = history.length - 1, stop = Math.max(0, history.length - 1000); i >= stop; i--) {
    var entry = history[i];
    if (entry && (entry.type === 'delta' || entry.type === 'assistant_message') && typeof entry.text === 'string' && entry.text.trim()) {
      var index = i, text = entry.text;
      while (index > stop && history[index - 1].type === 'delta' && entry.type === 'delta' ) { index--; text = (history[index].text + text).slice(0, 1200); }
      found = { id: String(index), text: text.slice(0, 1200), timestamp: history[index]._ts || null }; break;
    }
  }
  return found;
}
function attach(ctx) {
  var subscriptions = new WeakMap();
  function release(ws) {
    var old = subscriptions.get(ws); if (!old) return;
    subscriptions.delete(ws); old.entries.forEach(function (entry) { clearTimeout(entry.timer); if (entry.release) entry.release(); });
    if (ws.removeListener) ws.removeListener('close', old.close);
  }
  function handleMessage(ws, msg) {
    if (msg.type !== 'split_worker_preview_request') return false;
    release(ws);
    if (typeof msg.requestId !== 'string' || msg.requestId.length > 160 || !Array.isArray(msg.targets) || msg.targets.length > 32) return true;
    var state = { entries: [], close: function () { release(ws); } }; subscriptions.set(ws, state);
    msg.targets.forEach(function (target) {
      var pair = ctx.resolve(ws, target); if (!pair || state.entries.some(function (entry) { return entry.worker === pair.worker; })) return;
      var entry = { worker: pair.worker, timer: null, last: null };
      function send(live) {
        var current = ctx.resolve(ws, target);
        if (subscriptions.get(ws) !== state || ws.readyState !== 1 || !current || current.driver !== pair.driver || current.worker !== pair.worker) { if (entry.release) entry.release(); return; }
        var preview = latest(pair.worker.history || []); if (!preview) return;
        preview.vendor = pair.worker.vendor || null;
        if (entry.last === JSON.stringify(preview)) return;
        entry.last = JSON.stringify(preview);
        ctx.send(ws, { type: 'split_worker_message_preview', requestId: msg.requestId, parentSessionOriginId: target.parentSessionOriginId,
          workerSessionOriginId: target.workerSessionOriginId, generation: target.generation, live: live, preview: preview });
      }
      entry.release = ctx.sm.subscribeSession(pair.worker.localId, function (event) {
        if (!event || ['delta', 'assistant_message'].indexOf(event.type) < 0 || entry.timer) return;
        entry.timer = setTimeout(function () { entry.timer = null; send(true); }, 60);
      });
      state.entries.push(entry); send(false);
    });
    if (ws.once) ws.once('close', state.close);
    return true;
  }
  return { handleMessage: handleMessage };
}
module.exports = { attach: attach, latest: latest };
