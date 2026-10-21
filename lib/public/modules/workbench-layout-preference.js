import { store } from './store.js';
import { getWs } from './ws-ref.js';

var endpoint = '/api/user/workbench-layout';
function account() { return store.get('myUserId') || 'default'; }
function validMode(mode) { return mode === 'overlay' || mode === 'docked'; }
function state() { return store.get('workbenchLayoutPreference'); }
function defaults(previous) {
  var same = previous && previous.accountId === account();
  return { mode: same ? previous.mode : 'overlay', accountId: account(), ready: false, loading: false, saving: false,
    layouts: same ? previous.layouts || {} : {}, error: '', socket: getWs(), revision: same ? previous.revision : 0, generation: (previous && previous.generation || 0) + 1, checkedAt: 0 };
}
function initialize() {
  if (!state() || state().accountId !== account() || state().socket !== getWs()) store.set({ workbenchLayoutPreference: defaults(state()) });
  return state();
}
function current(receipt) {
  var live = state();
  return live && live.receipt === receipt && live.accountId === account() && live.generation === receipt.generation &&
    store.get('currentSlug') === receipt.project && getWs() === receipt.socket &&
    store.get('connected') === receipt.connected && store.get('authIdentityLoaded') === receipt.identity &&
    store.get('projectSplitViewSocketGeneration') === receipt.socketGeneration;
}
function request(mode, layout) {
  var before = initialize(), saving = mode !== undefined;
  var receipt = { generation: before.generation, project: store.get('currentSlug'), socket: getWs(),
    connected: store.get('connected'), identity: store.get('authIdentityLoaded'), socketGeneration: store.get('projectSplitViewSocketGeneration') };
  var controller = new AbortController();
  var pending = Object.assign({}, before, { loading: !saving, saving: saving, error: '', receipt: receipt });
  var promise = Promise.resolve().then(async function () {
    var timer = setTimeout(function () { controller.abort(); }, 15000);
    try {
      if (!current(receipt)) return false;
      var response = await fetch(endpoint, { method: saving ? 'PUT' : 'GET', credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', 'X-Clay-Settings': '1', 'X-Clay-Account-Id': before.accountId },
        body: saving ? JSON.stringify(Object.assign({ mode: mode, revision: before.revision }, layout ? { layout: layout } : {})) : undefined });
      var data = await response.json();
      if (!current(receipt)) return false;
      if (!response.ok) throw new Error(response.status === 409 ? 'Workbench layout changed elsewhere. Reload the preference and try again.' :
        saving ? 'Workbench layout could not be saved. Reload the preference before trying again.' : 'Workbench layout could not be loaded. Try again.');
      if (!data || data.accountId !== before.accountId || !validMode(data.mode) || !Number.isSafeInteger(data.revision) || data.revision < before.revision || data.revision === before.revision && data.mode !== before.mode ||
          saving && (data.mode !== mode || data.revision !== before.revision + (mode === before.mode && (!layout || JSON.stringify((before.layouts || {})[layout.key]) === JSON.stringify({ base: layout.base, tree: layout.tree })) ? 0 : 1))) throw new Error('Workbench preference response is stale. Reload and try again.');
      if (layout && (!data.layouts || JSON.stringify(data.layouts[layout.key]) !== JSON.stringify({ base: layout.base, tree: layout.tree }))) throw new Error('Window layout response is stale. Reload and try again.');
      store.set({ workbenchLayoutPreference: Object.assign({}, state(), { mode: data.mode, revision: data.revision, layouts: data.layouts || {},
        ready: true, loading: false, saving: false, error: '', checkedAt: Date.now(), receipt: null, promise: null }) });
      return true;
    } catch (error) {
      if (current(receipt)) store.set({ workbenchLayoutPreference: Object.assign({}, state(), { ready: false, loading: false, saving: false,
        receipt: null, promise: null, checkedAt: 0, error: error.name === 'AbortError' ? 'Workbench preference request timed out. Reload to check the saved layout.' : error.message }) });
      return false;
    } finally {
      clearTimeout(timer);
      if (state() && state().receipt === receipt && !current(receipt)) store.set({ workbenchLayoutPreference: Object.assign(defaults(state()), { error: 'Connection changed. Reload the workbench preference.' }) });
    }
  });
  pending.promise = promise;
  store.set({ workbenchLayoutPreference: pending });
  return promise;
}
export function ensureWorkbenchLayoutPreference() {
  var value = initialize();
  if (value.loading || value.saving) return value.promise || Promise.resolve(false);
  if (!store.get('authIdentityLoaded') || !store.get('connected')) return Promise.resolve(false);
  if (value.ready && Date.now() - value.checkedAt < 30000) return Promise.resolve(true);
  return request();
}
export function saveWorkbenchLayoutMode(mode) {
  var value = initialize();
  if (!validMode(mode) || !value.ready || value.loading || value.saving || !store.get('connected') || !store.get('authIdentityLoaded')) return Promise.resolve(false);
  return request(mode);
}
store.subscribe(function (next, previous) {
  if (next.myUserId !== previous.myUserId || next.currentSlug !== previous.currentSlug || next.connected !== previous.connected ||
      next.authIdentityLoaded !== previous.authIdentityLoaded || next.projectSplitViewSocketGeneration !== previous.projectSplitViewSocketGeneration) {
    store.set({ workbenchLayoutPreference: defaults(state()) });
  }
});

export function saveWorkbenchWindowLayout(key, tree, base) {
  var value = initialize();
  if (!value.ready || value.loading || value.saving || !store.get('connected') || !store.get('authIdentityLoaded')) return Promise.resolve(false);
  return request(value.mode, { key: key, tree: tree, base: base });
}
