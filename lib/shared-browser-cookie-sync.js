var cookieKey = require('./shared-browser-cookies').cookieKey;

// Only the private worker pipe carries cookies. They never enter browser state or tool output.
function attachCookieSync(context, initial, send) {
  var pending = null;
  var previous = initial;
  var nextId = 0;
  function receive(message) {
    if (!pending || pending.id !== message.id) return;
    var entry = pending; pending = null; clearTimeout(entry.timer);
    if (message.error) entry.reject(new Error(message.error));
    else entry.resolve(message.cookies);
  }
  async function sync() {
    var current = await context.cookies();
    var cookies = await new Promise(function (resolve, reject) {
      pending = { id: ++nextId, resolve: resolve, reject: reject, timer: setTimeout(function () { pending = null; reject(new Error('Could not synchronize browser cookies')); }, 4000) };
      try { send({ type: 'cookies', id: pending.id, previous: previous, cookies: current }); }
      catch (error) { clearTimeout(pending.timer); pending = null; reject(error); }
    });
    var remote = new Map(cookies.map(function (cookie) { return [cookieKey(cookie), cookie]; }));
    var local = new Map(current.map(function (cookie) { return [cookieKey(cookie), cookie]; }));
    var updates = cookies.filter(function (cookie) { return JSON.stringify(local.get(cookieKey(cookie))) !== JSON.stringify(cookie); });
    current.forEach(function (cookie) {
      if (!remote.has(cookieKey(cookie))) updates.push(Object.assign({}, cookie, { expires: 1 }));
    });
    if (updates.length) await context.addCookies(updates);
    previous = cookies;
  }
  return { start: function () { return context.addCookies(initial); }, sync: sync, receive: receive };
}
module.exports = { attachCookieSync: attachCookieSync };
