var crypto = require('crypto');
var cookies = require('./shared-browser-cookies');
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function empty() { return { generation: 0, cookies: [], origins: [], history: [], deletions: [] }; }
function mergeItems(saved, before, after, key) {
  var result = new Map(saved.map(function (item) { return [item[key], item]; }));
  var previous = new Map(before.map(function (item) { return [item[key], item]; }));
  var current = new Map(after.map(function (item) { return [item[key], item]; }));
  previous.forEach(function (item, id) { if (!current.has(id) && same(result.get(id), item)) result.delete(id); });
  current.forEach(function (item, id) { if (!same(previous.get(id), item)) result.set(id, item); });
  return Array.from(result.values());
}
function validate(state) {
  if (!state || !Array.isArray(state.cookies) || !Array.isArray(state.origins) || state.origins.length > 1000 || JSON.stringify(state).length > 12 * 1024 * 1024) throw new Error('Browser site data exceeds the storage limit');
  state.origins.forEach(function (entry) {
    var url = new URL(entry.origin);
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== entry.origin || !Array.isArray(entry.localStorage) || (entry.indexedDB && !Array.isArray(entry.indexedDB))) throw new Error('Invalid browser site data');
  });
  return state;
}
function mergeState(saved, previous, current) {
  validate(current); validate(previous);
  // A human deletion supersedes all snapshots taken before it, including dirty idle tabs.
  if (previous.generation !== saved.generation) return saved;
  var origins = new Map(saved.origins.map(function (origin) { return [origin.origin, origin]; }));
  var before = new Map(previous.origins.map(function (origin) { return [origin.origin, origin]; }));
  var after = new Map(current.origins.map(function (origin) { return [origin.origin, origin]; }));
  before.forEach(function (origin, key) { if (!after.has(key)) after.set(key, { origin: key, localStorage: [], indexedDB: [] }); });
  after.forEach(function (origin) {
    var old = before.get(origin.origin) || { localStorage: [], indexedDB: [] };
    var existing = origins.get(origin.origin) || { origin: origin.origin, localStorage: [], indexedDB: [] };
    origins.set(origin.origin, { origin: origin.origin,
      localStorage: mergeItems(existing.localStorage, old.localStorage, origin.localStorage, 'name'),
      indexedDB: mergeItems(existing.indexedDB || [], old.indexedDB || [], origin.indexedDB || [], 'name') });
  });
  return validate(Object.assign({}, saved, { cookies: cookies.mergeCookies(saved.cookies, previous.cookies, current.cookies), origins: Array.from(origins.values()) }));
}
function cookieId(cookie) { return crypto.createHash('sha256').update(cookies.cookieKey(cookie)).digest('hex'); }
function host(domain) { return domain.replace(/^\./, '').toLowerCase(); }
function summary(state) {
  var sites = new Map();
  function site(name) { if (!sites.has(name)) sites.set(name, { host: name, cookies: [], origins: [] }); return sites.get(name); }
  state.cookies.forEach(function (cookie) {
    site(host(cookie.domain)).cookies.push({ id: cookieId(cookie), name: cookie.name, domain: cookie.domain, path: cookie.path, expires: cookie.expires, httpOnly: !!cookie.httpOnly, secure: !!cookie.secure, partitioned: !!cookie.partitionKey });
  });
  state.origins.forEach(function (origin) {
    if (origin.localStorage.length || (origin.indexedDB || []).length) site(new URL(origin.origin).hostname).origins.push({ origin: origin.origin, localStorage: origin.localStorage.length, databases: (origin.indexedDB || []).length });
  });
  return { sites: Array.from(sites.values()).sort(function (a, b) { return a.host.localeCompare(b.host); }), history: state.history.slice().reverse() };
}
function remove(state, operation, target) {
  var next = JSON.parse(JSON.stringify(state));
  if (operation === 'clear_history') next.history = [];
  else if (operation === 'delete_history') next.history = next.history.filter(function (entry) { return entry.id !== target; });
  else {
    if (operation === 'clear_data') { next.cookies = []; next.origins = []; }
    else if (operation === 'delete_cookie') next.cookies = next.cookies.filter(function (cookie) { return cookieId(cookie) !== target; });
    else if (operation === 'delete_site') {
      next.cookies = next.cookies.filter(function (cookie) { return host(cookie.domain) !== target; });
      next.origins = next.origins.filter(function (origin) { return new URL(origin.origin).hostname !== target; });
    } else throw new Error('Invalid browser settings action');
    next.generation++;
    next.deletions = (next.deletions || []).concat([{ generation: next.generation, operation: operation, target: target || '' }]).slice(-1000);
  }
  return next;
}
function attachStorageStore(root) {
  var disk = cookies.attachEncryptedStore(root, 'browser-state', function () { return null; });
  var legacy = cookies.attachCookieStore(root);
  function read(owner) {
    var state = disk.read(owner);
    if (!state) { state = empty(); state.cookies = legacy.read(owner); disk.write(owner, state); if (state.cookies.length) legacy.clear(owner); }
    state.cookies = cookies.mergeCookies(state.cookies, [], []);
    return validate(state);
  }
  return {
    read: read,
    exchange: function (owner, previous, current) {
      var saved = read(owner), next = mergeState(saved, previous, current);
      if (!same(saved, next)) disk.write(owner, next);
      return next;
    },
    manage: function (owner, operation, target) {
      var state = read(owner);
      if (operation !== 'list') { state = remove(state, operation, target); disk.write(owner, state); }
      return summary(state);
    },
    visit: function (owner, value) {
      var url;
      try { url = new URL(value); } catch (error) { return; }
      if (!['http:', 'https:'].includes(url.protocol)) return;
      url.username = ''; url.password = ''; url.hash = '';
      var state = read(owner), text = url.href.slice(0, 2048);
      if (state.history.length && state.history[state.history.length - 1].url === text) return;
      state.history.push({ id: crypto.randomUUID(), url: text, at: Date.now() });
      state.history = state.history.slice(-500);
      disk.write(owner, state);
    },
  };
}
module.exports = { attachStorageStore: attachStorageStore, mergeState: mergeState, empty: empty, summary: summary, remove: remove };
