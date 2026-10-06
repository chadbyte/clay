import { sketchBrand, sketchCredit } from './wireframe-style.js';
import { store } from './store.js';
import { claimRightWorkbench, registerRightWorkbench, releaseRightWorkbench } from './right-workbench.js';
import { renderWireframe, wireframeSource, wireframeImage } from './wireframe-render.js';
import { refreshIcons } from './icons.js';
import { mountWireframeViewport } from './wireframe-viewport.js';

function panel() { return document.getElementById('wireframe-panel'); }
export function closeWireframe() {
  releaseRightWorkbench('wireframe');
  if (panel()) panel().remove();
  store.set({ wireframeDraft: null });
}

function download() {
  var draft = store.get('wireframeDraft');
  if (!draft) return;
  var link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([draft.source], { type: 'text/plain;charset=utf-8' }));
  link.download = (draft.id || 'wireframe') + '.puml';
  link.click();
  setTimeout(function () { URL.revokeObjectURL(link.href); }, 1000);
}

function save(event) {
  event.preventDefault();
  var el = panel();
  var draft = store.get('wireframeDraft');
  var form = el.querySelector('form');
  var button = form.querySelector('[type="submit"]');
  var status = el.querySelector('.wireframe-save-status');
  var requested = form.elements.path.value.trim();
  button.disabled = true; status.textContent = 'Saving…';
  fetch('api/wireframe/save', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: requested, source: draft.source }) }).then(function (response) {
    if (!response.ok) return response.text().then(function (text) { throw new Error(text); });
    return response.json();
  }).then(function (result) {
    if (store.get('wireframeDraft') !== draft) return;
    status.textContent = 'Saved to ' + result.path;
    form.hidden = true;
  }).catch(function (error) {
    if (store.get('wireframeDraft') === draft) status.textContent = error.message || 'Unable to save the wireframe.';
  }).finally(function () { button.disabled = false; });
}

function createPanel() {
  var host = document.getElementById('main-panels');
  if (!host) return null;
  var el = document.createElement('section'); el.id = 'wireframe-panel';
  el.setAttribute('aria-label', 'clay-sketch viewer');
  el.innerHTML = '<header class="wireframe-topbar"><div class="sketch-brand">' + sketchBrand() + '</div><strong class="sketch-title">Sketch viewer</strong><div class="wireframe-window-actions"><button type="button" data-wide title="Widen panel" aria-label="Widen panel" aria-pressed="false"><i data-lucide="chevrons-left-right"></i></button><button type="button" data-full title="Toggle fullscreen" aria-label="Toggle fullscreen" aria-pressed="false"><i data-lucide="maximize-2"></i></button><button type="button" data-close title="Close clay-sketch" aria-label="Close clay-sketch"><i data-lucide="x"></i></button></div></header><div class="wireframe-toolbar"><div class="wireframe-zoom"></div><button type="button" data-save>Save to project</button><button type="button" data-download title="Download sketch source" aria-label="Download sketch source"><i data-lucide="download"></i></button></div><form hidden class="wireframe-save-form"><label>Project file path<input name="path" aria-label="Project file path" required pattern=".*\\.puml" placeholder="wireframe.puml"></label><button type="submit">Save</button><button type="button" data-cancel>Cancel</button></form><p class="wireframe-save-status" role="status"></p><div class="wireframe-workbench-canvas"></div><footer class="sketch-footer">' + sketchCredit() + '<span>Revise through conversation</span></footer>';
  host.appendChild(el);
  el.querySelector('[data-close]').onclick = closeWireframe;
  el.querySelector('[data-download]').onclick = download;
  el.querySelector('[data-save]').onclick = function () {
    var form = el.querySelector('form'); form.hidden = false;
    var draft = store.get('wireframeDraft');
    form.elements.path.value = (draft.id || 'wireframe') + '.puml';
    form.elements.path.focus();
  };
  el.querySelector('[data-cancel]').onclick = function () { el.querySelector('form').hidden = true; el.querySelector('[data-save]').focus(); };
  el.querySelector('form').onsubmit = save;
  el.addEventListener('keydown', function (event) {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    if (!el.querySelector('form').hidden) el.querySelector('[data-cancel]').click();
    else closeWireframe();
  });
  ['wide', 'full'].forEach(function (action) {
    el.querySelector('[data-' + action + ']').onclick = function () {
      var active = el.classList.toggle(action === 'wide' ? 'wireframe-wide' : 'panel-fullscreen');
      this.setAttribute('aria-pressed', String(active));
    };
  });
  refreshIcons();
  return el;
}

export function openWireframe(message) {
  if (!message || typeof message.source !== 'string' || new TextEncoder().encode(message.source).length > 100000) return;
  if (store.get('paneMode') && window.parent !== window) {
    window.parent.postMessage({ type: 'clay-pane-present-wireframe', message: message, projectSlug: store.get('currentSlug'), sessionId: store.get('activeSessionId') }, window.location.origin);
    return;
  }
  claimRightWorkbench('wireframe');
  var el = panel() || createPanel();
  if (!el) return;
  var draft = { source: wireframeSource(message.source, message.language), title: String(message.title || 'clay-sketch').slice(0, 100),
    id: /^[a-zA-Z0-9_-]{1,80}$/.test(message.id || '') ? message.id : 'wireframe' };
  store.set({ wireframeDraft: draft });
  el.querySelector('header strong').textContent = draft.title;
  el.querySelector('.wireframe-save-status').textContent = '';
  el.querySelector('form').hidden = true;
  draw(draft, el).catch(function () {});
}
function draw(draft, el) {
  var canvas = el.querySelector('.wireframe-workbench-canvas');
  var active = store.get('wireframeDraft');
  var status = document.createElement('p'); status.setAttribute('role', 'status'); status.textContent = 'Rendering sketch…';
  canvas.replaceChildren(status);
  return renderWireframe(draft.source, canvas).then(function (svg) {
    if (store.get('wireframeDraft') !== active || !canvas.isConnected) throw new DOMException('Sketch changed.', 'AbortError');
    var image = wireframeImage(svg, draft.title);
    canvas.replaceChildren(image);
    mountWireframeViewport(canvas, image, el.querySelector('.wireframe-zoom'));
  }).catch(function (error) {
    if (store.get('wireframeDraft') !== active) throw error;
    status.textContent = error.name === 'AbortError' ? 'Rendering was interrupted. Reopen the wireframe to retry.' : error.message;
    throw error;
  });
}
registerRightWorkbench('wireframe', closeWireframe);
store.subscribe(function (state, previous) {
  if (state.currentSlug !== previous.currentSlug || state.activeSessionId !== previous.activeSessionId || state.myUserId !== previous.myUserId) closeWireframe();
});
