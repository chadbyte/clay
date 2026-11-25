import { store } from './store.js';
import { loadA2uiDocument } from './a2ui-document.js';

// Live frame ports are resources, not persisted UI preferences.
var frames = new Map();
var cleanupObserver;
function cleanup() {
  frames.forEach(function (resource, card) {
    if (card.isConnected) {
      var dark = !document.documentElement.classList.contains('light-theme');
      if (resource.dark !== dark) { resource.dark = dark; resource.port.postMessage({ type: 'theme', dark: dark }); }
      return;
    }
    clearTimeout(resource.timer); resource.port.close(); frames.delete(card);
  });
  if (!frames.size && cleanupObserver) { cleanupObserver.disconnect(); cleanupObserver = null; }
}
function mount(pre, source, doc) {
  var card = document.createElement('section');
  card.className = 'a2ui-card';
  card.setAttribute('aria-label', doc.title);
  var title = document.createElement('strong'); title.textContent = doc.title; card.appendChild(title);
  var summary = document.createElement('p'); summary.textContent = doc.summary; card.appendChild(summary);
  var status = document.createElement('p'); status.className = 'a2ui-status'; status.setAttribute('role', 'status');
  status.textContent = 'Loading interactive exploration…'; card.appendChild(status);
  var frame = document.createElement('iframe');
  frame.title = doc.title; frame.setAttribute('sandbox', 'allow-scripts'); frame.setAttribute('referrerpolicy', 'no-referrer');
  frame.setAttribute('allow', "camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'");
  frame.className = 'a2ui-frame';
  var details = document.createElement('details');
  var label = document.createElement('summary'); label.textContent = 'Response source'; details.appendChild(label);
  card.appendChild(frame); card.appendChild(details);
  pre.replaceWith(card); details.appendChild(pre);
  var channel = new MessageChannel();
  function failed() {
    clearTimeout(resource.timer); channel.port1.close(); frame.remove();
    status.textContent = 'Interactive view unavailable. The summary and response source are still available.';
  }
  var resource = { port: channel.port1, timer: setTimeout(failed, 15000) };
  frames.set(card, resource);
  channel.port1.onmessage = function (event) {
    if (!card.isConnected) { cleanup(); return; }
    var data = event.data || {};
    if (data.type === 'error') failed();
    if (data.type === 'ready') {
      clearTimeout(resource.timer);
      status.textContent = 'Explore locally · No message sent · Choices reset when reopened';
    }
    if (data.type === 'height' && Number.isFinite(data.height)) frame.style.height = Math.min(900, Math.max(80, data.height)) + 'px';
  };
  frame.addEventListener('load', function () {
    if (!card.isConnected || !frame.dataset.prepared) return;
    delete frame.dataset.prepared;
    frame.contentWindow.postMessage('clay-a2ui-init', '*', [channel.port2]);
    var dark = !document.documentElement.classList.contains('light-theme');
    resource.dark = dark;
    channel.port1.postMessage({ source: source, dark: dark });
  });
  loadA2uiDocument().then(function (html) {
    if (!card.isConnected || !frame.isConnected) return;
    frame.dataset.prepared = 'true'; frame.srcdoc = html;
  }).catch(failed);
  if (!cleanupObserver) { cleanupObserver = new MutationObserver(cleanup); cleanupObserver.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] }); }
}
export function renderA2uiBlocks(root) {
  if (store.get('replayingHistory')) return;
  root.querySelectorAll('pre code.language-clay-a2ui').forEach(function (code) {
    var pre = code.parentElement;
    // Render assistant answers only, never tool output, files, or user quotations.
    if (!pre || pre.dataset.a2uiProcessed || !pre.closest('.msg-assistant') || pre.closest('.tool-block, .tool-result, .tool-result-block, .tool-item, .msg-user')) return;
    if (pre.closest('.msg-assistant').querySelectorAll('.a2ui-card').length >= 3) return;
    var source = code.textContent;
    if (source.length > 100000) return;
    var doc;
    try { doc = JSON.parse(source); } catch (error) { return; }
    if (!doc || typeof doc.title !== 'string' || typeof doc.summary !== 'string' || doc.title.length > 120 || doc.summary.length > 2000) return;
    pre.dataset.a2uiProcessed = 'true';
    mount(pre, source, doc);
  });
}
