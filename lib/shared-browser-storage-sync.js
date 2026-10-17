var cookieKey = require('./shared-browser-cookies').cookieKey;
// Saved website data only crosses the private worker pipe, never the agent tool channel.
function attachStorageSync(context, initial, send) {
  var previous = initial, pending = null, nextId = 0;
  function receive(message) {
    if (!pending || pending.id !== message.id) return;
    var entry = pending; pending = null; clearTimeout(entry.timer);
    if (message.error) entry.reject(new Error(message.error)); else entry.resolve(message.storage);
  }
  async function sync() {
    var current = await context.storageState({ indexedDB: true });
    var saved = await new Promise(function (resolve, reject) {
      pending = { id: ++nextId, resolve: resolve, reject: reject, timer: setTimeout(function () { pending = null; reject(new Error('Could not synchronize browser site data')); }, 10000) };
      try { send({ type: 'storage', id: pending.id, previous: previous, storage: current }); }
      catch (error) { clearTimeout(pending.timer); pending = null; reject(error); }
    });
    var remote = new Map(saved.cookies.map(function (cookie) { return [cookieKey(cookie), cookie]; }));
    var local = new Map(current.cookies.map(function (cookie) { return [cookieKey(cookie), cookie]; }));
    var updates = saved.cookies.filter(function (cookie) { return JSON.stringify(local.get(cookieKey(cookie))) !== JSON.stringify(cookie); });
    current.cookies.forEach(function (cookie) { if (!remote.has(cookieKey(cookie))) updates.push(Object.assign({}, cookie, { expires: 1 })); });
    if (updates.length) await context.addCookies(updates);
    if (previous.generation !== saved.generation) {
      var deletions = (saved.deletions || []).filter(function (entry) { return entry.generation > previous.generation; });
      var unknown = !deletions.length || deletions[0].generation > previous.generation + 1;
      var removed = current.origins.filter(function (origin) {
        return unknown || deletions.some(function (entry) { return entry.operation === 'clear_data' || (entry.operation === 'delete_site' && new URL(origin.origin).hostname === entry.target); });
      });
      if (removed.length) {
        var page = context.pages()[0] || await context.newPage();
        var cdp = await context.newCDPSession(page);
        try {
          for (var origin of removed) await cdp.send('Storage.clearDataForOrigin', { origin: origin.origin, storageTypes: 'local_storage,indexeddb' });
        } finally { await cdp.detach(); }
      }
      current = await context.storageState({ indexedDB: true });
    }
    // Restore origin storage on new tabs, rather than replacing live IndexedDB connections.
    // Each open tab contributes only its own changes. Human removals also clear live origins.
    previous = { generation: saved.generation, cookies: saved.cookies, origins: current.origins };
  }
  return { start: function () { return context.setStorageState({ cookies: initial.cookies, origins: initial.origins }); }, sync: sync, receive: receive };
}
module.exports = { attachStorageSync: attachStorageSync };
