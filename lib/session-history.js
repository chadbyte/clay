var crypto = require('crypto');
var states = new WeakMap();
var immutable = new WeakSet();
var records = new WeakMap();

// Own JSON-compatible records, never caller-owned mutable references. Frozen
// records may be shared by forks; each session still owns its epoch and array.
function freeze(value) {
  if (value && typeof value === 'object') {
    Object.keys(value).forEach(function (key) { freeze(value[key]); });
    Object.freeze(value);
    immutable.add(value);
  }
  return value;
}
function own(value) {
  if (value && typeof value === 'object' && records.has(value)) return records.get(value).value;
  if (value && typeof value === 'object' && immutable.has(value)) return value;
  return freeze(JSON.parse(JSON.stringify(value)));
}
function denied() { throw new Error('Use the session history mutation service.'); }
function recordView(session, state, index, value) {
  if (!value || typeof value !== 'object') return { value: value, view: value, active: true };
  var record = { session: session, state: state, index: index, value: value, active: true };
  // Top-level record identity remains stable for proposal leases/transactions.
  // Reads follow authoritative edits; nested values remain immutable snapshots.
  record.view = new Proxy({}, {
    get: function (_, key) { return record.value[key]; },
    has: function (_, key) { return key in record.value; },
    ownKeys: function () { return Reflect.ownKeys(record.value); },
    getOwnPropertyDescriptor: function (_, key) {
      var descriptor = Object.getOwnPropertyDescriptor(record.value, key);
      return descriptor && Object.assign({}, descriptor, { configurable: true });
    },
    set: denied, deleteProperty: denied, defineProperty: denied, setPrototypeOf: denied, preventExtensions: denied,
  });
  records.set(record.view, record);
  return record;
}
function attach(session) {
  var state = states.get(session);
  if (state) return state;
  var entries = session.history || [];
  if (!Array.isArray(entries)) throw new Error('Session history must be an array.');
  state = { items: entries.map(own), epoch: crypto.randomUUID(), revision: 0, retired: false };
  state.records = state.items.map(function (value, index) { return recordView(session, state, index, value); });
  // This proxy only enforces a read-only array boundary; mutation tracking is
  // explicit below. No raw array or mutable record escapes the authority.
  state.view = new Proxy(state.items, {
    get: function (array, key) {
      // Compatibility for existing append/pop callers still enters the same
      // authority. Production writers use the explicit operations below.
      if (key === 'push') return function () { for (var i = 0; i < arguments.length; i++) append(session, arguments[i]); return state.items.length; };
      if (key === 'pop') return function () { var last = state.records[state.items.length - 1]; if (!last) return undefined; removeLast(session, last.view); return last.view; };
      if (typeof key === 'string' && /^(0|[1-9]\d*)$/.test(key)) return state.records[key] && state.records[key].view;
      return Reflect.get(array, key);
    },
    set: denied, deleteProperty: denied,
    defineProperty: denied, setPrototypeOf: denied, preventExtensions: denied });
  Object.defineProperty(session, 'history', { enumerable: true, configurable: false,
    get: function () { return state.view; },
    set: function (value) { replace(session, value); } });
  states.set(session, state);
  return state;
}
function attachSessionHistory(session, registry) {
  var state = attach(session);
  if (registry) {
    if (state.registry && state.registry !== registry) throw new Error('Session history belongs to another registry.');
    state.registry = registry;
  }
  return session.history;
}
function isCurrent(session, registry) {
  var state = states.get(session), bound = state && state.registry || registry;
  return !!session && !(state && state.retired) && (!bound || bound.get(session.localId) === session);
}
function token(state) { return 'history:' + state.epoch + ':' + state.revision; }
function current(session, expected) {
  var state = attach(session);
  if (state.retired) throw new Error('Session history was retired.');
  if (!isCurrent(session)) throw new Error('Session history identity was replaced.');
  if (expected !== undefined && expected !== token(state)) throw new Error('Session history changed.');
  return state;
}
function advance(state) {
  if (state.revision === Number.MAX_SAFE_INTEGER) { state.epoch = crypto.randomUUID(); state.revision = 0; }
  else state.revision++;
}
function revision(session) { return token(current(session)); }
function snapshot(session) {
  var state = current(session);
  // Copy only entry references. Reentrant send/transform callbacks cannot mix
  // later writes into this snapshot under its earlier revision token.
  return { history: Object.freeze(state.items.slice()), revision: token(state) };
}
function append(session, entry, expected) {
  var state = current(session, expected), started = token(state), record = own(entry);
  current(session, started);
  state.records.push(recordView(session, state, state.items.length, record));
  state.items.push(record); advance(state);
  return state.records[state.items.length - 1].view;
}
function replace(session, entries, expected) {
  var state = current(session, expected);
  if (entries === state.view) return;
  if (!Array.isArray(entries)) throw new Error('Session history must be an array.');
  var started = token(state), records = entries.map(own);
  current(session, started);
  // Keep the read-only view live without exposing its backing array.
  state.items.length = 0;
  state.records.forEach(function (record) { record.active = false; });
  state.records = [];
  for (var i = 0; i < records.length; i++) {
    state.items.push(records[i]);
    state.records.push(recordView(session, state, i, records[i]));
  }
  advance(state);
}
function update(session, index, edit, expected) {
  var state = current(session, expected);
  if (!Number.isInteger(index) || index < 0 || index >= state.items.length || typeof edit !== 'function') throw new Error('An exact history entry and synchronous edit are required.');
  var started = token(state);
  var before = JSON.stringify(state.items[index]), draft = JSON.parse(before), result = edit(draft);
  if (result && typeof result.then === 'function') throw new Error('History edits must be synchronous.');
  var record = own(result === undefined ? draft : result);
  // Revalidate after the callback, including reentrant mutations or retirement.
  if (current(session) !== state || token(state) !== started) throw new Error('Session history changed.');
  if (JSON.stringify(record) === before) return state.records[index].view;
  state.items[index] = record;
  state.records[index].value = record;
  advance(state);
  return state.records[index].view;
}
function truncate(session, length, expected) {
  var state = current(session, expected);
  if (!Number.isInteger(length) || length < 0 || length > state.items.length) throw new Error('Invalid history boundary.');
  if (length === state.items.length) return;
  state.records.slice(length).forEach(function (record) { record.active = false; });
  state.records.length = length; state.items.length = length; advance(state);
}
function removeLast(session, entry) {
  var state = current(session);
  if (!state.items.length || state.records[state.items.length - 1].view !== entry) return false;
  truncate(session, state.items.length - 1);
  return true;
}
function retire(session) {
  var state = attach(session);
  if (!state.retired) { advance(state); state.retired = true; }
}
function isRecord(value) { return !!value && typeof value === 'object' && records.has(value); }
function editRecord(reference, edit) {
  var record = records.get(reference);
  if (!record || !record.active || record.state.records[record.index] !== record) throw new Error('History entry was replaced or removed.');
  return update(record.session, record.index, edit);
}
module.exports = { attachSessionHistory: attachSessionHistory, revision: revision, snapshot: snapshot,
  append: append, replace: replace, update: update, truncate: truncate, removeLast: removeLast, retire: retire,
  isRecord: isRecord, editRecord: editRecord, isCurrent: isCurrent };
