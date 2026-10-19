import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { copyToClipboard } from './utils.js';
import { getCachedSessions } from './sidebar-sessions.js';
import { iconHtml } from './icons.js';
import { formatTokens } from './app-panels.js';
import { VENDOR_AVATARS, VENDOR_NAMES } from './app-rendering.js';
import { createPermissionControl, bindPermissionControl, renderPermissionControl } from './permission-control.js';
import { splitGroupRoles } from './split-group-helpers.js';
import { paneTarget, livePaneBinding, samePaneTarget, samePaneBinding } from './pane-binding.js';
import { syncPairChrome, clearPanePairChrome } from './split-pair-ui.js';
import { renderPaneWorkers } from './split-view-workers.js';
import { toggleSidebarCollapse } from './sidebar.js';

function sessionById(sessionId) {
  var sessions = getCachedSessions() || [];
  for (var i = 0; i < sessions.length; i++) if (sessions[i].id === sessionId) return sessions[i];
  return null;
}

function paneUrl(pane) {
  return "/p/" + encodeURIComponent(pane.slug) + "/?pane=1&session=" + encodeURIComponent(pane.sessionId);
}

function headerBindingStamp(frame) {
  var live = frame.clayPane && frame.clayPane.identity();
  return JSON.stringify([frame.dataset.sessionId, frame.dataset.sessionOriginId,
    live && live.binding && live.binding.requestId, live && live.binding && live.binding.generation]);
}

function startPaneRename(header, titleEl, pane) {
  if (header.querySelector(".split-pane-rename-input")) return;
  var section = header.parentNode, frame = section.querySelector('.split-pane-frame');
  var initial = frame && frame.clayPane && frame.clayPane.identity();
  if (!initial || !initial.ready || !livePaneBinding(frame) || initial.sessionId !== pane.sessionId ||
      initial.binding.sessionOriginId !== frame.dataset.sessionOriginId) return;
  var input = document.createElement("input");
  input.type = "text"; input.className = "split-pane-rename-input"; input.value = pane.title;
  titleEl.style.display = "none"; header.insertBefore(input, titleEl); input.focus(); input.select();
  var done = false;
  var origin = frame.dataset.sessionOriginId, binding = initial.binding, socket = getWs();
  function current() {
    var live = frame.clayPane && frame.clayPane.identity();
    return header.isConnected && !header.inert && socket === getWs() && store.get('connected') &&
      frame.dataset.sessionId === String(pane.sessionId) && frame.dataset.sessionOriginId === origin && !frame.dataset.requestedSessionId &&
      !!live && live.ready && live.sessionId === pane.sessionId && live.binding.sessionOriginId === origin &&
      livePaneBinding(frame) && samePaneBinding(live.binding, binding);
  }
  function finish(commit) {
    if (done) return;
    done = true;
    var newTitle = input.value.trim(); input.remove(); titleEl.style.display = "";
    if (!commit || !current() || !newTitle || newTitle === pane.title) return;
    pane.title = newTitle; titleEl.textContent = newTitle;
    var ws = getWs();
    if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: "rename_session", id: pane.sessionId, title: newTitle }));
  }
  input.addEventListener("keydown", function (event) {
    if (event.key === "Enter") { event.preventDefault(); finish(true); }
    if (event.key === "Escape") { event.preventDefault(); finish(false); }
  });
  input.addEventListener("blur", function () { finish(true); });
  header.addEventListener('clay-pane-retarget', function cancel() { finish(false); header.removeEventListener('clay-pane-retarget', cancel); });
  input.addEventListener("click", function (event) { event.stopPropagation(); });
}

function permissionState(session) {
  var mode = session && (session.runtimeMode || session.mode || "gui");
  var worker = !!session && isConfiguredWorker(store.get('splitGroups'), session.id);
  return {
    projectSlug: store.get('currentSlug'), sessionId: session && session.id,
    vendor: session && session.vendor || store.get('currentVendor') || "claude",
    permissionMode: session && session.permissionMode || "default",
    effectivePermissionMode: session && session.effectivePermissionMode || null,
    permissionCapabilities: session && session.permissionCapabilities || { auto: false, mcpOverride: false },
    connected: store.get('connected'), globalPermissionModeForced: store.get('skipPermsEnabled') === true,
    visible: !!session && !worker && mode === "gui", locked: worker,
  };
}

function isConfiguredWorker(groups, sessionId) {
  for (var i = 0; i < (groups || []).length; i++) {
    var roles = splitGroupRoles(groups[i]);
    if (roles && roles.workerIds.indexOf(sessionId) !== -1) return true;
  }
  return false;
}

export function updatePaneFullAccessButton(button, session) {
  if (button) renderPermissionControl(button, permissionState(session));
}

export function createSplitPane(pane, closePane) {
  var paneEl = document.createElement("section"); paneEl.className = "split-pane";
  var header = document.createElement("header"); header.className = "split-pane-header"; header.title = pane.title;
  var session = sessionById(pane.sessionId); var vendor = session && session.vendor || "unknown";
  var vendorIcon = document.createElement("img"); vendorIcon.className = "split-pane-vendor"; vendorIcon.hidden = !VENDOR_AVATARS[vendor];
  if (!vendorIcon.hidden) vendorIcon.src = VENDOR_AVATARS[vendor]; vendorIcon.alt = ""; vendorIcon.title = VENDOR_NAMES[vendor] || vendor; header.appendChild(vendorIcon);
  var title = document.createElement("span"); title.className = "split-pane-title"; title.textContent = pane.title; title.title = "Rename session";
  title.addEventListener("click", function () { var current = sessionById(Number(paneEl.dataset.sessionId)); if (current) startPaneRename(header, title, { sessionId: current.id, title: current.title }); }); header.appendChild(title);
  var frame = document.createElement("iframe"); frame.className = "split-pane-frame"; frame.dataset.projectSlug = pane.slug;
  frame.dataset.sessionId = String(pane.sessionId); frame.src = paneUrl(pane); frame.title = pane.title;
  frame.dataset.sessionOriginId = session && session.sessionOriginId || '';
  header.addEventListener('pointerdown', function () { header.dataset.pointerSessionId = frame.dataset.sessionId; header.dataset.pointerBinding = headerBindingStamp(frame); });
  header.addEventListener('click', function (event) {
    if (frame.clayPane && (!livePaneBinding(frame) || event.detail && header.dataset.pointerBinding !== headerBindingStamp(frame))) {
      event.preventDefault(); event.stopImmediatePropagation();
    }
  }, true);
  ['keydown', 'keyup'].forEach(function (name) {
    header.addEventListener(name, function (event) {
      var stamp = headerBindingStamp(frame);
      if (name === 'keydown' && !event.repeat) header.dataset.keyBinding = stamp;
      if (header.inert || header.dataset.keyBinding !== stamp) { event.preventDefault(); event.stopImmediatePropagation(); }
    }, true);
  });
  var ctxChip = document.createElement("button"); ctxChip.type = "button"; ctxChip.className = "split-pane-context"; ctxChip.title = "Context usage";
  ctxChip.innerHTML = '<span class="split-pane-context-bar"><span class="split-pane-context-fill"></span></span><span class="split-pane-context-label"></span>';
  ctxChip.addEventListener("click", function () { if (frame.contentWindow && (!frame.clayPane || livePaneBinding(frame))) frame.contentWindow.postMessage({ type: "clay-pane-toggle-context", paneBinding: frame.clayPane && frame.clayPane.identity().binding }, window.location.origin); }); header.appendChild(ctxChip);
  var fullAccess = createPermissionControl("split-pane-full-access hidden", "Driver session permission mode");
  updatePaneFullAccessButton(fullAccess, session); bindPermissionControl(fullAccess, function () { return permissionState(sessionById(Number(paneEl.dataset.sessionId))); }); header.appendChild(fullAccess); header.insertBefore(fullAccess, ctxChip);
  var close = document.createElement("button"); close.type = "button"; close.className = "split-pane-close"; close.title = "Close pane"; close.setAttribute("aria-label", "Close pane"); close.innerHTML = iconHtml("x");
  if (store.get('projectSplitViewSingletonOrigin') === (session && session.sessionOriginId)) {
    close.hidden = true; close.title = "The only pane cannot be closed"; close.setAttribute("aria-label", "The only pane cannot be closed");
  }
  close.dataset.sessionId = String(pane.sessionId); close.addEventListener("click", function () { closePane(Number(this.dataset.sessionId)); }); header.appendChild(close);
  var info = document.createElement("button"); info.type = "button"; info.className = "split-pane-info"; info.setAttribute("aria-label", "Session information"); info.title = "Session information"; info.innerHTML = iconHtml("info");
  info.addEventListener("click", function (event) { event.stopPropagation(); togglePaneInfo(info, frame); }); header.appendChild(info);
  var sidebarButton = document.createElement("button"); sidebarButton.type = "button"; sidebarButton.className = "split-pane-sidebar"; sidebarButton.setAttribute("aria-label", "Toggle sidebar"); sidebarButton.title = "Toggle sidebar"; sidebarButton.innerHTML = iconHtml("panel-left");
  sidebarButton.addEventListener("click", function (event) {
    event.stopPropagation();
    var live = frame.clayPane && frame.clayPane.identity();
    var activePane = paneEl.dataset.active === "true" || live && store.get('projectSplitViewSingletonOrigin') === live.binding.sessionOriginId;
    if (!live || !live.ready || !livePaneBinding(frame) || live.sessionId !== Number(frame.dataset.sessionId) ||
        live.binding.sessionOriginId !== frame.dataset.sessionOriginId || !activePane) return;
    toggleSidebarCollapse();
  }); header.appendChild(sidebarButton);
  var search = document.createElement("button"); search.type = "button"; search.className = "split-pane-search"; search.setAttribute("aria-label", "Search this session"); search.title = "Search this session"; search.innerHTML = iconHtml("search");
  search.addEventListener("click", function (event) {
    event.stopPropagation();
    var live = frame.clayPane && frame.clayPane.identity();
    if (!live || !live.ready || !livePaneBinding(frame) || live.sessionId !== Number(frame.dataset.sessionId) ||
        live.binding.sessionOriginId !== frame.dataset.sessionOriginId || Number(paneEl.dataset.sessionId) !== live.sessionId) return;
    frame.contentWindow.postMessage({ type: "clay-pane-toggle-search", paneBinding: live.binding }, window.location.origin);
  });
  header.insertBefore(search, close);
  frame.addEventListener('clay-pane-ready', function () {
    if (paneEl.classList.contains('split-pane-cached')) return;
    var id = Number(frame.dataset.requestedSessionId || frame.dataset.sessionId), current = sessionById(id);
    var live = frame.clayPane && frame.clayPane.identity(), target = paneTarget(store.snap(), getCachedSessions(), id);
    if (!current || !live || !live.ready || !samePaneTarget(target, live.binding) || live.sessionId !== id) return;
    frame.dataset.sessionId = String(id); delete frame.dataset.requestedSessionId;
    frame.dataset.sessionOriginId = live.binding.sessionOriginId;
    updateSplitPaneMetadata(paneEl, { slug: frame.dataset.projectSlug, sessionId: id, title: current.title });
    syncPairChrome(paneEl.parentNode, store.get('splitPanes'));
  });
  frame.addEventListener('clay-pane-activation-failed', function () {
    if (paneEl.classList.contains('split-pane-cached')) return;
    var id = Number(frame.dataset.requestedSessionId || frame.dataset.sessionId);
    var fallbackTarget = paneTarget(store.snap(), getCachedSessions(), id);
    if (!fallbackTarget) { header.inert = true; return; }
    frame.dataset.sessionOriginId = fallbackTarget.sessionOriginId;
    frame.src = paneUrl({ slug: frame.dataset.projectSlug, sessionId: id });
    frame.dataset.sessionId = String(id); delete frame.dataset.requestedSessionId;
  });
  paneEl.appendChild(header);
  var runtime = document.createElement("div"); runtime.className = "split-view-runtime";
  vendorIcon.classList.add("split-view-runtime-icon"); runtime.appendChild(vendorIcon);
  var runtimeModel = document.createElement("span"); runtimeModel.className = "split-view-model"; runtime.appendChild(runtimeModel);
  header.insertBefore(runtime, title); header.appendChild(close); paneEl.appendChild(frame); return paneEl;
}

function togglePaneInfo(anchor, frame) {
  var existing = document.getElementById("split-pane-info-popover");
  if (existing) { existing.remove(); if (existing.dataset.origin === frame.dataset.sessionOriginId) return; }
  var live = frame.clayPane && frame.clayPane.identity();
  if (!live || !live.ready || !livePaneBinding(frame) || live.binding.sessionOriginId !== frame.dataset.sessionOriginId || live.sessionId !== Number(frame.dataset.sessionId)) return;
  var session = sessionById(live.sessionId);
  if (!session || session.sessionOriginId !== live.binding.sessionOriginId) return;
  var binding = live.binding;
  function current() {
    var currentLive = frame.clayPane && frame.clayPane.identity();
    return anchor.isConnected && !anchor.closest('.split-pane-header').inert && frame.dataset.sessionId === String(session.id) &&
      frame.dataset.sessionOriginId === session.sessionOriginId && !frame.dataset.requestedSessionId && currentLive &&
      currentLive.ready && currentLive.sessionId === session.id && samePaneBinding(currentLive.binding, binding) && livePaneBinding(frame);
  }
  var pop = document.createElement("div"); pop.id = "split-pane-info-popover"; pop.className = "session-info-popover"; pop.dataset.origin = session.sessionOriginId;
  var values = [["Local ID", session.id]];
  if (session.cliSessionId) values.push(["Session ID", session.cliSessionId]);
  var vendor = (store.get("vendorInfo") || {})[session.vendor || "claude"] || {};
  if (session.cliSessionId && vendor.terminalResumeCommand) values.push(["Resume", vendor.terminalResumeCommand + " " + session.cliSessionId]);
  values.forEach(function (entry) {
    var row = document.createElement("div"); row.className = "info-row";
    var label = document.createElement("span"); label.className = "info-label"; label.textContent = entry[0];
    var value = document.createElement("span"); value.className = "info-value"; value.textContent = String(entry[1]);
    var copy = document.createElement("button"); copy.type = "button"; copy.className = "info-copy-btn"; copy.title = "Copy " + entry[0]; copy.setAttribute("aria-label", "Copy " + entry[0]); copy.innerHTML = iconHtml("copy");
    copy.addEventListener("click", function () { if (!current()) { pop.remove(); return; } copyToClipboard(String(entry[1])).then(function () { if (pop.isConnected && current()) copy.innerHTML = iconHtml("check"); }); });
    row.append(label, value, copy); pop.appendChild(row);
  });
  document.body.appendChild(pop);
  var rect = anchor.getBoundingClientRect(); pop.style.top = (rect.bottom + 6) + "px"; pop.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - pop.offsetWidth - 8)) + "px";
  function dismiss(event) { if (event.type === "keydown" && event.key !== "Escape") return; if (event.type === "click" && (pop.contains(event.target) || anchor.contains(event.target))) return; pop.remove(); document.removeEventListener("click", dismiss, true); document.removeEventListener("keydown", dismiss, true); frame.removeEventListener('clay-pane-retarget', dismiss); frame.removeEventListener('clay-pane-ready', dismiss); if (event.type === "keydown") anchor.focus(); }
  document.addEventListener("click", dismiss, true); document.addEventListener("keydown", dismiss, true);
  frame.addEventListener('clay-pane-retarget', dismiss); frame.addEventListener('clay-pane-ready', dismiss);
}

export function updateSplitPaneMetadata(paneEl, pane) {
  clearPanePairChrome(paneEl);
  var session = sessionById(pane.sessionId); var header = paneEl.querySelector(".split-pane-header");
  var title = paneEl.querySelector(".split-pane-title"); var frame = paneEl.querySelector(".split-pane-frame"); var vendor = paneEl.querySelector(".split-pane-vendor");
  var live = frame && frame.clayPane && frame.clayPane.identity();
  var retarget = frame && (Number(frame.dataset.sessionId) !== pane.sessionId || frame.dataset.sessionOriginId !== (session && session.sessionOriginId || '') || frame.clayPane && (!live || !live.ready));
  if (retarget && header) {
    header.dispatchEvent(new Event('clay-pane-retarget'));
    header.inert = true;
    header.title = 'Loading conversation';
    if (title) { title.style.display = ''; title.textContent = 'Loading conversation'; }
    if (vendor) vendor.hidden = true;
    var permission = paneEl.querySelector('.split-pane-full-access');
    if (permission) permission.classList.add('hidden');
    resetPaneContextChip(paneEl);
  }
  if (frame && frame.clayPane && retarget) {
    var target = paneTarget(store.snap(), getCachedSessions(), pane.sessionId);
    if (target && frame.clayPane.source === frame.contentWindow && frame.clayPane.document === frame.contentDocument) {
      // Publish the requested target before activate() can synchronously queue
      // store updates or a session_list can prime the frame's previous URL id.
      frame.dataset.requestedSessionId = String(pane.sessionId);
      if (frame.clayPane.activate(pane.sessionId, false, target)) {
        if (header) header.inert = true;
        return;
      }
      delete frame.dataset.requestedSessionId;
    }
    frame.src = paneUrl(pane);
    frame.dataset.sessionId = String(pane.sessionId); frame.dataset.projectSlug = pane.slug;
    frame.dataset.sessionOriginId = session && session.sessionOriginId || '';
  }
  if (header) header.inert = false;
  paneEl.dataset.sessionId = String(pane.sessionId); paneEl.dataset.projectSlug = pane.slug;
  paneEl.dataset.sessionOrigin = session && session.sessionOriginId || "";
  if (header) header.title = pane.title; if (title && title.style.display !== "none") title.textContent = pane.title; if (frame) frame.title = pane.title;
  var sidebarButton = paneEl.querySelector('.split-pane-sidebar');
  if (sidebarButton) sidebarButton.hidden = store.get('projectSplitViewSingletonOrigin') !== (session && session.sessionOriginId) && paneEl.dataset.active !== 'true';
  if (vendor) { var vendorName = session && session.vendor || "unknown"; vendor.hidden = !VENDOR_AVATARS[vendorName]; if (!vendor.hidden) vendor.src = VENDOR_AVATARS[vendorName]; vendor.title = VENDOR_NAMES[vendorName] || vendorName; }
  var runtime = paneEl.querySelector('.split-view-runtime');
  var runtimeName = session && session.vendor || "unknown", runtimeModelName = session && typeof session.model === "string" && session.model.trim() || "Model unavailable";
  var runtimeIcon = runtime.querySelector('.split-view-runtime-icon'), runtimeModel = runtime.querySelector('.split-view-model');
  if (runtimeIcon) { runtimeIcon.hidden = !VENDOR_AVATARS[runtimeName]; if (!runtimeIcon.hidden) runtimeIcon.src = VENDOR_AVATARS[runtimeName]; runtimeIcon.title = VENDOR_NAMES[runtimeName] || runtimeName; runtimeIcon.alt = ""; }
  if (runtimeModel) { runtimeModel.textContent = runtimeModelName; runtimeModel.title = (VENDOR_NAMES[runtimeName] || runtimeName) + " · " + runtimeModelName; }
  runtime.setAttribute("aria-label", (VENDOR_NAMES[runtimeName] || runtimeName) + " · " + runtimeModelName);
  renderPaneWorkers(paneEl, session);
  updatePaneFullAccessButton(paneEl.querySelector('.split-pane-full-access'), session);
  updateSplitPaneCloseVisibility(paneEl, pane.sessionId);
}

export function updateSplitPaneCloseVisibility(paneEl, sessionId) {
  var close = paneEl && paneEl.querySelector('.split-pane-close');
  if (!close) return;
  var paneHost = paneEl.parentNode;
  var singletonOnly = !!paneHost && paneHost.id === 'split-host' && paneHost.dataset && paneHost.dataset.singlePane === 'true' &&
    paneHost.querySelectorAll(':scope > .split-pane').length === 1;
  if (sessionId != null) close.dataset.sessionId = String(sessionId);
  close.hidden = singletonOnly;
  close.disabled = singletonOnly;
  close.title = singletonOnly ? "The only pane cannot be closed" : "Close pane";
  close.setAttribute("aria-label", close.title);
}

function resetPaneContextChip(paneEl) {
  var chip = paneEl.querySelector('.split-pane-context'); if (!chip) return;
  chip.classList.remove('has-data'); chip.title = 'Context usage';
  var fill = chip.querySelector('.split-pane-context-fill'), label = chip.querySelector('.split-pane-context-label');
  if (fill) { fill.style.width = '0%'; fill.className = 'split-pane-context-fill'; }
  if (label) label.textContent = '';
}

export function updatePaneContextChip(paneEl, msg) {
  if (!paneEl) return; var chip = paneEl.querySelector(".split-pane-context"); if (!chip) return; var pct = msg.pct || 0; if (pct <= 0) { resetPaneContextChip(paneEl); return; }
  chip.classList.add("has-data"); var fill = chip.querySelector(".split-pane-context-fill"); var label = chip.querySelector(".split-pane-context-label");
  fill.style.width = Math.min(100, pct).toFixed(1) + "%"; fill.className = "split-pane-context-fill" + (msg.cls || ""); label.textContent = pct.toFixed(0) + "%";
  var tip = "Context " + pct.toFixed(0) + "% (" + formatTokens(msg.used || 0) + " / " + formatTokens(msg.win || 0) + " tokens)";
  if (msg.cost) tip += " · $" + msg.cost.toFixed(4); if (msg.model && msg.model !== "-") tip += " · " + msg.model; chip.title = tip;
}
