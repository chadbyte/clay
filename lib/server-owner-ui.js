var crypto = require('crypto');
// Only authenticated application sockets enumerated by the server are targets.
function attachOwnerUi(ctx) {
  var identities = new WeakMap(), capabilities = new WeakMap(), deliveries = new Map();
  function alive(ws, owner) {
    return ws && ws.readyState === 1 && (!ws._clayAuthCheck || ws._clayAuthCheck()) &&
      (ctx.isMultiUser() ? !!owner && ws._clayUser && ws._clayUser.id === owner && !!ctx.findUser(owner) : !ws._clayUser);
  }
  function sockets(owner) {
    var all = new Map();
    ctx.forEachClient(function (ws, slug) {
      if (!alive(ws, owner) || all.has(ws)) return;
      if (!identities.has(ws)) identities.set(ws, 'viewer:' + crypto.randomUUID());
      all.set(ws, { ws: ws, ref: identities.get(ws), slug: slug || null, sessionId: ws._clayActiveSession || null,
        supported: capabilities.get(ws) === 1 && !ws._clayPane });
    });
    return Array.from(all.values());
  }
  function get(owner, ref) { return sockets(owner).find(function (item) { return item.ref === ref; }); }
  function inspect(owner, ref) {
    var viewer = get(owner, ref);
    if (!viewer) throw new Error('The exact owner UI connection is absent or revoked.');
    return viewer;
  }
  function check(owner, original) {
    var live = inspect(owner, original.ref);
    if (live.ws !== original.ws || live.slug !== original.slug || live.sessionId !== original.sessionId || live.supported !== original.supported) throw new Error('The selected viewer context changed. Inspect again.');
    return live;
  }
  function deliver(owner, original, target, revalidate) {
    revalidate(); var viewer = check(owner, original);
    if (!viewer.supported) return { status: 'unsupported', delivered: false, acknowledged: false, visible: 'unknown' };
    if (deliveries.size >= 100) {
      deliveries.forEach(function (item, key) { if (Date.now() - item.created > 300000) deliveries.delete(key); });
      if (deliveries.size >= 100) throw new Error('UI delivery capacity is full; wait for earlier attempts to expire.');
    }
    var id = 'navigation:' + crypto.randomUUID();
    var record = { owner: owner, viewer: viewer, target: target, revalidate: revalidate, created: Date.now(), claimed: false,
      result: { status: 'delivered', deliveryId: id, delivered: false, acknowledged: false, visible: 'unknown' } };
    deliveries.set(id, record);
    try {
      viewer.ws.send(JSON.stringify({ type: 'clay_navigation_offer', deliveryId: id }));
      if (!alive(viewer.ws, owner)) throw new Error('Viewer authorization or connection ended during delivery.');
      record.result.delivered = true;
    } catch (error) { record.result.status = 'failed'; record.result.error = error.message; record.result.retrySafe = false; }
    return Object.assign({}, record.result);
  }
  function read(owner, id) {
    var record = deliveries.get(id);
    if (!record || record.owner !== owner) throw new Error('No delivery exists for this owner.');
    record.revalidate();
    return Object.assign({}, record.result);
  }
  function handleMessage(ws, msg) {
    if (['clay_ui_ready', 'clay_navigation_claim', 'clay_navigation_ack'].indexOf(msg.type) < 0) return false;
    var owner = ctx.isMultiUser() ? ws._clayUser && ws._clayUser.id : null;
    if (!sockets(owner).some(function (item) { return item.ws === ws; })) return true;
    if (msg.type === 'clay_ui_ready') { if (msg.version === 1) capabilities.set(ws, 1); return true; }
    var record = deliveries.get(msg.deliveryId);
    if (!record || record.viewer.ws !== ws || record.owner !== owner || Date.now() - record.created > 30000) return true;
    try {
      record.revalidate();
      if (msg.type === 'clay_navigation_claim') {
        if (record.claimed) return true;
        check(owner, record.viewer); record.claimed = true;
        ws.send(JSON.stringify({ type: 'clay_navigation_apply', deliveryId: msg.deliveryId, target: record.target }));
      } else if (record.claimed && !record.result.acknowledged && ['accepted', 'refused', 'failed'].indexOf(msg.status) >= 0) {
        record.result.acknowledged = true;
        // Accepted only confirms invocation of the existing navigator, never rendering.
        record.result.clientStatus = msg.status;
      }
    } catch (error) { record.result.status = 'failed'; record.result.error = error.message; record.result.retrySafe = false; }
    return true;
  }
  return { list: sockets, inspect: inspect, check: check, deliver: deliver, read: read, handleMessage: handleMessage };
}
module.exports = { attachOwnerUi: attachOwnerUi };
