import { store } from './store.js';
import '../workspace-background-catalog.js';
export var workspaceBackgrounds = globalThis.ClayWorkspaceBackgrounds;

export function effectiveAppearance(state) {
  state = state || store.snap();
  var pref = state.appearanceDraft || state.appearancePreference || {};
  var preview = state.appearanceColorPreview;
  if (!preview || !workspaceBackgrounds.normalizeCustom([preview])) return pref;
  return Object.assign({}, pref, { background: 'plain', backgroundColor: preview.id,
    customBackgroundColors: (pref.customBackgroundColors || []).filter(function (color) { return color.id !== preview.id; }).concat([preview]) });
}

export function appearanceStatus(text, error) {
  store.set({ appearanceSaveStatus: text, appearanceSaveError: !!error });
  var status = document.getElementById('us-appearance-status');
  if (status) { status.textContent = text; status.dataset.state = error ? 'error' : ''; }
}
export function initWorkspaceBackground() {
  function sync(state) {
    var pref = effectiveAppearance(state);
    var color = workspaceBackgrounds.getColor(pref.backgroundColor, pref.customBackgroundColors);
    document.documentElement.dataset.workspaceColor = color.id;
    document.documentElement.style.setProperty('--workspace-solid-light', color.light);
    document.documentElement.style.setProperty('--workspace-solid-dark', color.dark);
    document.documentElement.dataset.workspaceBackground = pref.background === 'workshop' ? 'workshop' : 'plain';
  }
  store.subscribe(function (state, previous) {
    if (previous.myUserId && state.myUserId !== previous.myUserId) {
      store.set({ appearanceColorEditor: null, appearanceColorPreview: null, appearanceDraft: null, appearancePreference: null });
      return;
    }
    if (state.appearanceDraft !== previous.appearanceDraft || state.appearancePreference !== previous.appearancePreference || state.appearanceColorPreview !== previous.appearanceColorPreview) sync(state);
  });
}

export function selectAppearanceBackground(background, backgroundColor) {
  if (['plain', 'workshop'].indexOf(background) < 0 || (store.get('appearanceColorEditor') || {}).saving) return;
  var current = store.get('appearanceDraft') || store.get('appearancePreference') || {};
  if (backgroundColor !== undefined && !workspaceBackgrounds.isColor(backgroundColor, current.customBackgroundColors)) return;
  store.set({ appearanceColorPreview: null });
  var values = Object.assign({}, current, { background: background });
  values.backgroundColor = workspaceBackgrounds.getColor(backgroundColor === undefined ? current.backgroundColor : backgroundColor, current.customBackgroundColors).id;
  delete values.configured;
  ['lightTheme', 'darkTheme'].forEach(function (key) { if (!values[key]) delete values[key]; });
  return queueAppearanceSave(values);
}

export function queueAppearanceSave(values) {
  delete values.configured;
  ['lightTheme', 'darkTheme'].forEach(function (key) { if (!values[key]) delete values[key]; });
  store.set({ appearanceDraft: values, appearancePendingSaves: (store.get('appearancePendingSaves') || 0) + 1 });
  var owner = store.get('myUserId') || null;
  appearanceStatus('Saving appearance…');
  var queue = store.get('appearanceSaveQueue') || Promise.resolve();
  var next = queue.catch(function () {}).then(function () { return persistAppearance(values, owner); });
  store.set({ appearanceSaveQueue: next });
  return next;
}
async function persistAppearance(values, owner) {
  var request = (store.get('appearanceSaveRequest') || 0) + 1;
  store.set({ appearanceSaveRequest: request });
  appearanceStatus('Saving appearance…');
  var controller = new AbortController();
  var timeout = setTimeout(function () { controller.abort(); }, 12000);
  try {
    if ((store.get('myUserId') || null) !== owner) throw new Error('Account changed. Reload before saving appearance.');
    var custom = workspaceBackgrounds.normalizeCustom(values.customBackgroundColors || []);
    if (!custom || !workspaceBackgrounds.isColor(values.backgroundColor || workspaceBackgrounds.defaultColorId, custom)) throw new Error('Invalid workspace color.');
    var response = await fetch('/api/user/appearance', {method:'PUT',headers:{'Content-Type':'application/json','X-Clay-Settings':'1'},body:JSON.stringify(values),signal:controller.signal});
    if (!response.ok) throw new Error('Could not save appearance. Your preview remains. Retry to save it.');
    if (store.get('appearanceSaveRequest') !== request || (store.get('myUserId') || null) !== owner) return false;
    var saved = await response.json();
    store.set({ appearancePreference: saved, appearanceDraft: store.get('appearanceDraft') === values ? null : store.get('appearanceDraft') });
    ['clay-theme','clay-skin','clay-mode','clay-theme-vars','clay-theme-variant'].forEach(function (key) {try {localStorage.removeItem(key);}catch(error){}});
    if (store.get('appearanceDraft')) { appearanceStatus('Saving appearance…'); return true; }
    appearanceStatus('Saved. Applied to this view; other devices use it when they reload.');
    return true;
  } catch(error) {if(store.get('appearanceSaveRequest') === request) appearanceStatus(store.get('appearanceDraft') === values ? (error.name === 'AbortError' ? 'Save acknowledgement timed out. Retry to save your preview.' : error.message) : 'Saving appearance…', store.get('appearanceDraft') === values); return false;}
  finally { clearTimeout(timeout); store.set({ appearancePendingSaves: Math.max(0, (store.get('appearancePendingSaves') || 1) - 1) }); }
}
