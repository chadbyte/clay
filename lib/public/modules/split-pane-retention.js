import { getWs } from './ws-ref.js';
import { store } from './store.js';
import { getCachedSessions } from './sidebar-sessions.js';
import { paneTarget, samePaneTarget } from './pane-binding.js';

// DOM resources are local to this parent document, never store data.
var pools = new Map();
var clock = 0;
function scope(state) {
  if (!state.authIdentityLoaded || state.paneMode || state.dmMode || state.activeProjectMateId ||
      !state.currentSlug || /^mate-/.test(state.currentSlug) || state.activeProjectSlug !== state.currentSlug || state.sessionListProjectSlug !== state.currentSlug) return null;
  return JSON.stringify([state.currentSlug, state.currentProjectOwnerId, state.myUserId, state.controlRuntimeId, state.cwd,
    state.isOsUsers, state.paneOsIdentity]);
}
function target(state, id) {
  var session = (getCachedSessions() || []).find(function (item) { return item.id === id; });
  if (!session || session.hidden || session.isTui || session.sessionRole === 'worker' || (session.ownerId || null) !== (state.myUserId || null)) return null;
  return paneTarget(state, getCachedSessions(), id);
}
// Conversation identity controls teardown; execution-group metadata controls
// warm reuse and action authority, not the lifetime of a visible Driver DOM.
function sameConversation(a, b) {
  return !!a && !!b && ['projectSlug', 'viewerId', 'ownerId', 'sessionId', 'sessionOriginId',
    'role', 'workerGeneration', 'parentSessionOriginId'].every(function (key) { return a[key] === b[key]; });
}
function suspend(node) {
  var frame = node.querySelector('.split-pane-frame'), header = node.querySelector('.split-pane-header');
  if (header) { header.inert = true; header.dispatchEvent(new Event('clay-pane-retarget')); }
  if (frame) {
    if (frame.clayPane) frame.clayPane.suspend();
    frame.dispatchEvent(new Event('clay-pane-retarget'));
  }
}
function evict(pool, node) {
  pool.entries.delete(node);
  if (node.dispatchEvent) node.dispatchEvent(new Event('clay-pane-dispose'));
  suspend(node); node.remove();
}
export function clearRetainedPanes(host) {
  var pool = pools.get(host);
  if (!pool) return;
  Array.from(pool.entries.keys()).forEach(function (node) { evict(pool, node); });
  pools.delete(host);
}
export function disposePaneChildren(host) {
  Array.from(host && host.children || []).forEach(function (pane) {
    if (pane.dispatchEvent) pane.dispatchEvent(new Event('clay-pane-dispose'));
  });
}
// Leave active nodes attached for the existing legacy reconciler; never hand
// hidden cached documents to a Worker pair.
export function releaseRetainedPanes(host) {
  var pool = pools.get(host);
  if (!pool) return;
  Array.from(pool.entries.keys()).forEach(function (node) {
    if (node.classList.contains('split-pane-cached')) evict(pool, node);
  });
  pools.delete(host);
}
function invalidateTransport(pool, suspendActive) {
  Array.from(pool.entries.entries()).forEach(function (entry) {
    var node = entry[0];
    if (node.classList.contains('split-pane-cached')) evict(pool, node);
    else {
      entry[1].reuseInvalidated = true;
      // Keep the visible source for truthful connection feedback. Child
      // authority is suspended on the actual connection lifecycle boundary.
      if (suspendActive) {
        var frame = node.querySelector('.split-pane-frame'), header = node.querySelector('.split-pane-header');
        if (header) header.inert = true;
        if (frame && frame.clayPane) frame.clayPane.suspend();
      }
    }
  });
}
function prune(host, pool) {
  var state = store.snap();
  if (scope(state) !== pool.scope) { clearRetainedPanes(host); return false; }
  var generation = state.projectSplitViewSocketGeneration;
  if (getWs() !== pool.socket || generation !== pool.generation || state.connected !== pool.connected) {
    invalidateTransport(pool, !state.connected || generation !== pool.generation);
    pool.socket = getWs(); pool.generation = generation; pool.connected = state.connected;
  }
  if (state.splitPanes) { releaseRetainedPanes(host); return false; }
  Array.from(pool.entries.entries()).forEach(function (entry) {
    var node = entry[0], record = entry[1];
    var current = target(state, record.target.sessionId);
    if (node.parentNode !== host || !sameConversation(record.target, current)) { evict(pool, node); return; }
    if (!samePaneTarget(record.target, current)) {
      if (node.classList.contains('split-pane-cached')) evict(pool, node);
      else record.reuseInvalidated = true;
    }
  });
  return true;
}
export function paneRetention(host) {
  var key = scope(store.snap()), pool = pools.get(host);
  if (pool && !prune(host, pool)) pool = null;
  if (!key || !store.get('connected') || !getWs() || store.get('splitPanes')) return null;
  if (!pool) { pool = { scope: key, socket: getWs(), generation: store.get('projectSplitViewSocketGeneration'), connected: store.get('connected'), entries: new Map() }; pools.set(host, pool); }
  return {
    limit: 8,
    age: function (node) { return (pool.entries.get(node) || {}).used || 0; },
    remember: function (node, pane) {
      var binding = target(store.snap(), pane.sessionId);
      if (binding) pool.entries.set(node, { target: binding, used: ++clock });
    },
    retain: function (node) {
      var record = pool.entries.get(node), frame = node.querySelector('.split-pane-frame');
      var api = frame && frame.clayPane, live = api && api.identity();
      return !!(record && !record.reuseInvalidated && api && typeof api.suspend === 'function' && api.source === frame.contentWindow && api.document === frame.contentDocument &&
        live && samePaneTarget(record.target, live.binding) && samePaneTarget(record.target, target(store.snap(), record.target.sessionId)) && !frame.dataset.requestedSessionId);
    },
    canRetarget: function (node) {
      if (pool.entries.has(node)) return this.retain(node);
      // Legacy nodes are not pool entries. Validate their actual current
      // document and authoritative source before handing them to activation.
      var state = store.snap(), frame = node.querySelector('.split-pane-frame');
      var api = frame && frame.clayPane, live = api && api.identity();
      var session = live && (getCachedSessions() || []).find(function (item) { return item.id === live.sessionId; });
      return !!(node.parentNode === host && node.classList.contains('split-pane') && !node.hidden &&
        scope(state) === pool.scope && getWs() === pool.socket && session && !session.hidden &&
        (session.ownerId || null) === (state.myUserId || null) && api.source === frame.contentWindow && api.document === frame.contentDocument &&
        samePaneTarget(live.binding, paneTarget(state, getCachedSessions(), live.sessionId)) && !frame.dataset.requestedSessionId);
    },
    park: function (node) {
      if (node.classList.contains('split-pane-cached')) return;
      suspend(node); node.hidden = true; node.inert = true; node.style.display = 'none';
      node.classList.remove('split-pane'); node.classList.add('split-pane-cached');
    },
    restore: function (node) {
      var record = pool.entries.get(node);
      if (record && record.reuseInvalidated) suspend(node);
      node.classList.remove('split-pane-cached'); node.classList.add('split-pane');
      node.hidden = false; node.inert = false; node.style.display = '';
    },
    evict: function (node) { evict(pool, node); },
  };
}
store.subscribe(function (state, previous) {
  var removedView = state.projectSplitViews !== previous.projectSplitViews && (previous.projectSplitViews || []).some(function (view) {
    return !(state.projectSplitViews || []).some(function (current) { return current.id === view.id; });
  });
  pools.forEach(function (pool, host) {
    if (!prune(host, pool)) return;
    if (removedView) Array.from(pool.entries.keys()).forEach(function (node) { if (node.classList.contains('split-pane-cached')) evict(pool, node); });
  });
});
if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('pagehide', function () {
  Array.from(pools.keys()).forEach(clearRetainedPanes);
});
