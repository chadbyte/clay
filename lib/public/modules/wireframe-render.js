import { store } from './store.js';

export function wireframeSource(source, language) {
  source = String(source || '');
  if (language === 'salt' && !/@start\w+/i.test(source)) return '@startsalt\n' + source + '\n@endsalt';
  return source;
}

export function wireframeImage(svg, title) {
  if (svg.length > 8 * 1024 * 1024 || !/<svg[\s>]/i.test(svg)) throw new Error('The renderer returned an invalid diagram.');
  var image = document.createElement('img');
  image.alt = title || 'Wireframe';
  image.draggable = false;
  // SVG is displayed in an inert image context, never inserted as markup.
  image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  return image;
}

function pump() {
  if (store.get('wireframeRenderActive')) return;
  var queue = (store.get('wireframeRenderQueue') || []).slice();
  var job = queue.shift();
  if (!job) return;
  store.set({ wireframeRenderQueue: queue });
  if (!job.target.isConnected) { job.reject(new Error('Preview closed.')); pump(); return; }
  var controller = new AbortController();
  store.set({ wireframeRenderActive: controller });
  var timer = setTimeout(function () { controller.abort(); }, 20000);
  fetch('api/wireframe/render', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: job.source }), signal: controller.signal, cache: 'no-store' }).then(function (response) {
    return response.text().then(function (text) {
      if (!response.ok) throw new Error(text || 'Unable to render this wireframe.');
      return text;
    });
  }).then(function (svg) {
    if (store.get('wireframeRenderActive') !== controller) throw new Error('Conversation changed.');
    wireframeImage(svg);
    if (svg.length < 500000) {
      var cache = (store.get('wireframeRenderCache') || []).filter(function (entry) { return entry.source !== job.source; });
      cache.push({ source: job.source, svg: svg });
      store.set({ wireframeRenderCache: cache.slice(-12) });
    }
    job.resolve(svg);
  }).catch(function (error) { job.reject(error); }).finally(function () {
    clearTimeout(timer);
    if (store.get('wireframeRenderActive') === controller) store.set({ wireframeRenderActive: null });
    pump();
  });
}

export function renderWireframe(source, target) {
  if (!source.trim() || new TextEncoder().encode(source).length > 100000) return Promise.reject(new Error('Wireframes must contain between 1 byte and 100 KB of source.'));
  var cache = store.get('wireframeRenderCache') || [];
  var hit = cache.find(function (entry) { return entry.source === source; });
  if (hit) return Promise.resolve(hit.svg);
  return new Promise(function (resolve, reject) {
    var queue = (store.get('wireframeRenderQueue') || []).slice();
    queue.push({ source: source, target: target, resolve: resolve, reject: reject });
    store.set({ wireframeRenderQueue: queue });
    pump();
  });
}

store.subscribe(function (state, previous) {
  if (state.currentSlug === previous.currentSlug && state.activeSessionId === previous.activeSessionId && state.myUserId === previous.myUserId) return;
  if (previous.wireframeRenderActive) previous.wireframeRenderActive.abort();
  (previous.wireframeRenderQueue || []).forEach(function (job) { job.reject(new Error('Conversation changed.')); });
  store.set({ wireframeRenderActive: null, wireframeRenderQueue: [], wireframeRenderCache: [] });
});
