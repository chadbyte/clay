import { store } from './store.js';
import { mountWireframeViewport } from './wireframe-viewport.js';
import { sketchBrand, sketchCredit } from './wireframe-style.js';

export function isPlantUmlFile(path) {
  return /\.(puml|plantuml|pu|uml|salt)$/i.test(String(path || ""));
}

export function cancelPlantUmlPreview() {
  var job = store.get('plantUmlPreviewJob');
  if (!job) return;
  clearTimeout(job.timer);
  job.observer.disconnect();
  job.controller.abort();
  store.set({ plantUmlPreviewJob: null });
}

export function renderPlantUmlPreview(body, source, path) {
  cancelPlantUmlPreview();
  body.innerHTML = "";
  var preview = document.createElement("div");
  preview.className = "file-viewer-plantuml-preview";
  var status = document.createElement("div");
  status.className = "file-tree-loading";
  status.setAttribute("role", "status");
  status.textContent = "Rendering diagram…";
  preview.appendChild(status);
  body.appendChild(preview);

  function showError(message) {
    status.className = "file-tree-error";
    status.textContent = message + " Use Show source to inspect the file.";
  }
  if (!String(source || "").trim()) { showError("This diagram is empty."); return; }
  if (new TextEncoder().encode(source).length > 100000) { showError("Diagram is too large to preview (100 KB maximum)."); return; }

  var job = { controller: new AbortController(), observer: null, timer: null };
  job.observer = new MutationObserver(function () {
    if (!preview.isConnected && store.get('plantUmlPreviewJob') === job) cancelPlantUmlPreview();
  });
  job.observer.observe(body, { childList: true });
  job.timer = setTimeout(function () {
    if (store.get('plantUmlPreviewJob') !== job) return;
    showError("The diagram preview timed out.");
    cancelPlantUmlPreview();
  }, 20000);
  store.set({ plantUmlPreviewJob: job });
  fetch("api/file/plantuml?path=" + encodeURIComponent(path), { signal: job.controller.signal, cache: "no-store" }).then(function (response) {
    return response.text().then(function (text) {
      if (!response.ok) throw new Error(text || "Unable to render this diagram.");
      return text;
    });
  }).then(function (svg) {
    if (store.get('plantUmlPreviewJob') !== job || !preview.isConnected) return;
    if (svg.length > 8 * 1024 * 1024 || !/<svg[\s>]/i.test(svg)) throw new Error("The renderer returned an invalid diagram.");
    var image = document.createElement("img");
    image.alt = "Diagram preview of " + path;
    image.draggable = false;
    // An image context disables scripts, links and external SVG resources.
    image.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    image.addEventListener("error", function () { showError("The diagram image could not be displayed."); });
    status.textContent = "";
    var heading = document.createElement('header'); heading.className = 'sketch-tools';
    heading.innerHTML = '<div class="sketch-brand">' + sketchBrand() + '</div>' + sketchCredit();
    preview.appendChild(heading);
    var toolbar = document.createElement('div');
    var viewport = document.createElement('div'); viewport.className = 'wireframe-file-canvas';
    preview.appendChild(toolbar); preview.appendChild(viewport); viewport.appendChild(image);
    mountWireframeViewport(viewport, image, toolbar);

  }).catch(function (error) {
    if (store.get('plantUmlPreviewJob') === job && error.name !== "AbortError") showError(error.message);
  }).finally(function () {
    if (store.get('plantUmlPreviewJob') === job) cancelPlantUmlPreview();
  });
}
