import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { getCachedSessions } from './sidebar-sessions.js';
import { iconHtml } from './icons.js';
import { formatTokens } from './app-panels.js';
import { VENDOR_AVATARS, VENDOR_NAMES } from './app-rendering.js';
import { createPermissionControl, bindPermissionControl, renderPermissionControl } from './permission-control.js';
import { splitGroupRoles } from './split-group-helpers.js';

function sessionById(sessionId) {
  var sessions = getCachedSessions() || [];
  for (var i = 0; i < sessions.length; i++) if (sessions[i].id === sessionId) return sessions[i];
  return null;
}

function paneUrl(pane) {
  return "/p/" + encodeURIComponent(pane.slug) + "/?pane=1&session=" + encodeURIComponent(pane.sessionId);
}

function startPaneRename(header, titleEl, pane) {
  if (header.querySelector(".split-pane-rename-input")) return;
  var input = document.createElement("input");
  input.type = "text"; input.className = "split-pane-rename-input"; input.value = pane.title;
  titleEl.style.display = "none"; header.insertBefore(input, titleEl); input.focus(); input.select();
  var done = false;
  function finish(commit) {
    if (done) return;
    done = true;
    var newTitle = input.value.trim(); input.remove(); titleEl.style.display = "";
    if (!commit || !newTitle || newTitle === pane.title) return;
    pane.title = newTitle; titleEl.textContent = newTitle;
    var ws = getWs();
    if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: "rename_session", id: pane.sessionId, title: newTitle }));
  }
  input.addEventListener("keydown", function (event) {
    if (event.key === "Enter") { event.preventDefault(); finish(true); }
    if (event.key === "Escape") { event.preventDefault(); finish(false); }
  });
  input.addEventListener("blur", function () { finish(true); });
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
  var session = sessionById(pane.sessionId); var vendor = session && session.vendor || "claude";
  var vendorIcon = document.createElement("img"); vendorIcon.className = "split-pane-vendor";
  vendorIcon.src = VENDOR_AVATARS[vendor] || VENDOR_AVATARS.claude; vendorIcon.alt = ""; vendorIcon.title = VENDOR_NAMES[vendor] || vendor; header.appendChild(vendorIcon);
  var title = document.createElement("span"); title.className = "split-pane-title"; title.textContent = pane.title; title.title = "Rename session";
  title.addEventListener("click", function () { startPaneRename(header, title, pane); }); header.appendChild(title);
  var frame = document.createElement("iframe"); frame.className = "split-pane-frame"; frame.dataset.projectSlug = pane.slug;
  frame.dataset.sessionId = String(pane.sessionId); frame.src = paneUrl(pane); frame.title = pane.title;
  var ctxChip = document.createElement("button"); ctxChip.type = "button"; ctxChip.className = "split-pane-context"; ctxChip.title = "Context usage";
  ctxChip.innerHTML = '<span class="split-pane-context-bar"><span class="split-pane-context-fill"></span></span><span class="split-pane-context-label"></span>';
  ctxChip.addEventListener("click", function () { if (frame.contentWindow) frame.contentWindow.postMessage({ type: "clay-pane-toggle-context" }, window.location.origin); }); header.appendChild(ctxChip);
  var fullAccess = createPermissionControl("split-pane-full-access hidden", "Driver session permission mode");
  updatePaneFullAccessButton(fullAccess, session); bindPermissionControl(fullAccess, function () { return permissionState(sessionById(pane.sessionId)); }); header.appendChild(fullAccess); header.insertBefore(fullAccess, ctxChip);
  var close = document.createElement("button"); close.type = "button"; close.className = "split-pane-close"; close.title = "Close pane"; close.setAttribute("aria-label", "Close pane"); close.innerHTML = iconHtml("x");
  close.dataset.sessionId = String(pane.sessionId); close.addEventListener("click", function () { closePane(Number(this.dataset.sessionId)); }); header.appendChild(close);
  paneEl.appendChild(header); paneEl.appendChild(frame); return paneEl;
}

export function updateSplitPaneMetadata(paneEl, pane) {
  var session = sessionById(pane.sessionId); var header = paneEl.querySelector(".split-pane-header");
  var title = paneEl.querySelector(".split-pane-title"); var frame = paneEl.querySelector(".split-pane-frame"); var vendor = paneEl.querySelector(".split-pane-vendor");
  paneEl.dataset.sessionId = String(pane.sessionId); paneEl.dataset.projectSlug = pane.slug;
  if (header) header.title = pane.title; if (title && title.style.display !== "none") title.textContent = pane.title; if (frame) frame.title = pane.title;
  if (vendor) { var vendorName = session && session.vendor || "claude"; vendor.src = VENDOR_AVATARS[vendorName] || VENDOR_AVATARS.claude; vendor.title = VENDOR_NAMES[vendorName] || vendorName; }
  var close = paneEl.querySelector(".split-pane-close");
  if (close) {
    close.dataset.sessionId = String(pane.sessionId); close.disabled = false; close.title = "Close pane"; close.setAttribute("aria-label", close.title);
  }
}

export function updatePaneContextChip(paneEl, msg) {
  if (!paneEl) return; var chip = paneEl.querySelector(".split-pane-context"); if (!chip) return; var pct = msg.pct || 0; if (pct <= 0) return;
  chip.classList.add("has-data"); var fill = chip.querySelector(".split-pane-context-fill"); var label = chip.querySelector(".split-pane-context-label");
  fill.style.width = Math.min(100, pct).toFixed(1) + "%"; fill.className = "split-pane-context-fill" + (msg.cls || ""); label.textContent = pct.toFixed(0) + "%";
  var tip = "Context " + pct.toFixed(0) + "% (" + formatTokens(msg.used || 0) + " / " + formatTokens(msg.win || 0) + " tokens)";
  if (msg.cost) tip += " · $" + msg.cost.toFixed(4); if (msg.model && msg.model !== "-") tip += " · " + msg.model; chip.title = tip;
}
