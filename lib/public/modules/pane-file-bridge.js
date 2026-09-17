import { store } from './store.js';

function paneFrame(host, source) {
  if (!host || !source) return null;
  var frames = host.querySelectorAll(".split-pane-frame");
  for (var i = 0; i < frames.length; i++) {
    if (frames[i].contentWindow === source) return frames[i];
  }
  return null;
}

function matchingPane(frame, split) {
  if (!frame || !split || !split.panes) return null;
  for (var i = 0; i < split.panes.length; i++) {
    var pane = split.panes[i];
    if (String(pane.slug) === String(frame.dataset.projectSlug) && String(pane.sessionId) === String(frame.dataset.sessionId)) return pane;
  }
  return null;
}

function hasLivePaneSource(frame, pane) {
  if (!frame || !pane || typeof frame.src !== "string") return false;
  var expected = "/p/" + encodeURIComponent(pane.slug) + "/?pane=1&session=" + encodeURIComponent(pane.sessionId);
  try { return new URL(expected, window.location.href).href === frame.src; } catch (e) { return false; }
}

function validLocation(value) {
  return value == null || (Number.isSafeInteger(value) && value > 0);
}

export function revealFilesPanel() {
  var filesPanel = document.getElementById("sidebar-panel-files");
  if (!filesPanel || !filesPanel.classList.contains("hidden")) return false;
  var filesButton = document.getElementById("file-browser-btn");
  if (!filesButton) return false;
  filesButton.click();
  return true;
}

export function forwardPaneFileReference(path, opts) {
  if (!store.get('paneMode') || window.parent === window || typeof path !== "string" || !path) return false;
  window.parent.postMessage({
    type: "clay-pane-open-file",
    path: path,
    line: opts && opts.line != null ? opts.line : null,
    column: opts && opts.column != null ? opts.column : null,
    projectSlug: opts && opts.projectSlug ? opts.projectSlug : store.get('currentSlug'),
    sessionId: opts && opts.sessionId != null ? String(opts.sessionId) : (store.get('activeSessionId') != null ? String(store.get('activeSessionId')) : null),
  }, window.location.origin);
  return true;
}

export function handlePaneFileMessage(event, host, openFile, openFiles) {
  if (!event || event.origin !== window.location.origin || !host) return false;
  var msg = event.data;
  if (!msg || msg.type !== "clay-pane-open-file") return false;
  var frame = paneFrame(host, event.source);
  var state = store.snap();
  var pane = matchingPane(frame, state.splitPanes);
  if (!pane || !hasLivePaneSource(frame, pane) || String(pane.slug) !== String(state.currentSlug) || msg.projectSlug !== frame.dataset.projectSlug || String(msg.sessionId) !== String(frame.dataset.sessionId) || !validLocation(msg.line) || !validLocation(msg.column)) return true;
  if (typeof msg.path !== "string" || !msg.path) return true;
  if (!state.connected || typeof openFile !== "function") return true;
  // The frame/session association was validated above. The host browser owns
  // the read, so do not apply the pane session as a host-session restriction;
  // the normal authenticated project filesystem checks remain authoritative.
  var result = openFile(msg.path, { line: msg.line, column: msg.column, projectSlug: msg.projectSlug });
  if (result !== false && typeof openFiles === "function") openFiles();
  return true;
}
