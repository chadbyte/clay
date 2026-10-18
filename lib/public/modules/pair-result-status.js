import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { showConfirm } from './app-misc.js';
import { iconHtml, refreshIcons } from './icons.js';

var statusGeneration = 0;
// Whether the review tray is open lives in the store (pairResultTrayOpen), so it
// survives server re-renders and resets on clear or session switch.
function isTrayOpen() { return !!store.get("pairResultTrayOpen"); }
function setTrayOpen(open) { if (isTrayOpen() !== open) store.set({ pairResultTrayOpen: open }); }

function retrySource(item) {
  return { item: item, generation: statusGeneration, projectSlug: store.get("currentSlug") || store.get("activeProjectSlug") || null,
    sessionId: store.get("activeSessionId"), userId: store.get("myUserId") || null, ws: getWs() };
}

function sendRetry(source, confirmed) {
  var ws = getWs();
  var projectSlug = store.get("currentSlug") || store.get("activeProjectSlug") || null;
  var items = store.get("pairResultStatus") || [];
  var stillVisible = items.some(function (item) { return item.id === source.item.id; });
  if (!ws || ws !== source.ws || ws.readyState !== 1 || statusGeneration !== source.generation ||
      store.get("activeSessionId") !== source.sessionId || projectSlug !== source.projectSlug ||
      (store.get("myUserId") || null) !== source.userId || !stillVisible) return false;
  ws.send(JSON.stringify({ type: "pair_result_retry", id: source.item.id, confirmDuplicate: confirmed === true,
    sessionId: source.sessionId, projectSlug: source.projectSlug }));
  return true;
}

function retry(item) {
  var source = retrySource(item);
  if (item.confirmDuplicate) {
    showConfirm("The Driver may already have received this completed result. Retry delivery anyway? This can cause a duplicate result receipt.", function () {
      sendRetry(source, true);
    }, "Retry delivery", false);
    return;
  }
  sendRetry(source, false);
}

function dismiss(items) {
  var ws = getWs();
  if (!ws || ws.readyState !== 1) return;
  items.forEach(function (item) {
    ws.send(JSON.stringify({ type: "pair_result_dismiss", id: item.id, revision: item.revision,
      sessionId: store.get("activeSessionId"),
      projectSlug: store.get("currentSlug") || store.get("activeProjectSlug") || null }));
  });
}

function worstState(items) {
  if (items.some(function (item) { return item.state === "blocked"; })) return "blocked";
  if (items.some(function (item) { return item.state === "uncertain"; })) return "uncertain";
  return "pending";
}

function stateWords(state) {
  return state === "blocked" ? "blocked" : (state === "uncertain" ? "delivery uncertain" : "pending");
}

function button(className, label, icon) {
  var node = document.createElement("button");
  node.type = "button"; node.className = className;
  if (label) node.setAttribute("aria-label", label);
  if (icon) node.innerHTML = iconHtml(icon);
  return node;
}

function renderCard(item) {
  var card = document.createElement("div");
  card.className = "pair-result-status-card pair-result-status-" + item.state;
  var title = document.createElement("strong");
  title.textContent = item.state === "blocked" ? "Split Worker result blocked" :
    (item.state === "uncertain" ? (item.hasCompletedResult === false ? "Split Worker recovery uncertain" : "Split Worker result delivery uncertain") : "Split Worker result pending");
  var message = document.createElement("span");
  message.textContent = item.message || "The completed result is retained.";
  card.appendChild(title); card.appendChild(message);
  if (item.hasCompletedResult !== false) {
    var details = document.createElement("details"), summary = document.createElement("summary"), body = document.createElement("pre");
    summary.textContent = "View completed result";
    body.textContent = item.error ? "Error: " + item.error : (item.response || "No text response was recorded.");
    details.appendChild(summary); details.appendChild(body); card.appendChild(details);
  }
  if (item.canRetry) {
    var retryButton = button("pair-result-status-retry", null, null);
    retryButton.textContent = "Retry delivery";
    retryButton.addEventListener("click", retry.bind(null, item));
    card.appendChild(retryButton);
  }
  return card;
}

function renderPairResultStatus() {
  var existing = document.getElementById("pair-result-status");
  var focusedToggle = !!(existing && existing.ownerDocument.activeElement && existing.ownerDocument.activeElement.className === "pair-result-status-toggle");
  if (existing) existing.remove();
  var items = store.get("pairResultStatus") || [];
  if (!items.length) { setTrayOpen(false); return; }
  var messages = document.getElementById("messages");
  if (!messages || !messages.parentElement) return;
  var trayOpen = isTrayOpen();
  var state = worstState(items);
  var label = items.length === 1 ? "Worker update" : items.length + " Worker updates";
  var section = document.createElement("section");
  section.id = "pair-result-status";
  section.className = "pair-result-status pair-result-status-tone-" + state + (trayOpen ? " is-open" : "");
  var bar = document.createElement("div");
  bar.className = "pair-result-status-bar";
  var toggle = button("pair-result-status-toggle", null, null);
  toggle.setAttribute("aria-expanded", trayOpen ? "true" : "false");
  toggle.setAttribute("aria-controls", "pair-result-status-tray");
  toggle.innerHTML = '<span class="pair-result-status-icon" aria-hidden="true">' + iconHtml(state === "pending" ? "clock" : "triangle-alert") + '</span>' +
    '<span class="pair-result-status-label">' + label + '</span>' +
    '<span class="pair-result-status-state">, ' + stateWords(state) + '.</span>' +
    '<span class="pair-result-status-review">Review</span>' +
    '<span class="pair-result-status-chevron" aria-hidden="true">' + iconHtml("chevron-down") + '</span>';
  // One short polite announcement; the details stay in the tray.
  var live = document.createElement("span");
  live.className = "pair-result-status-live"; live.setAttribute("role", "status"); live.textContent = label;
  bar.appendChild(live);
  var close = button("pair-result-status-dismiss", "Dismiss Worker notices", "x");
  close.title = "Dismiss notices. Retained tasks and results are kept.";
  close.addEventListener("click", dismiss.bind(null, items));
  bar.appendChild(toggle); bar.appendChild(close); section.appendChild(bar);
  var tray = document.createElement("div");
  tray.id = "pair-result-status-tray"; tray.className = "pair-result-status-tray";
  tray.hidden = !trayOpen;
  for (var i = 0; i < items.length; i++) tray.appendChild(renderCard(items[i]));
  section.appendChild(tray);
  toggle.addEventListener("click", function () {
    trayOpen = !isTrayOpen(); setTrayOpen(trayOpen);
    toggle.setAttribute("aria-expanded", trayOpen ? "true" : "false");
    tray.hidden = !trayOpen;
    section.className = section.className.replace(/ is-open/g, "") + (trayOpen ? " is-open" : "");
  });
  section.addEventListener("keydown", function (event) {
    if (event.key !== "Escape" || !isTrayOpen()) return;
    trayOpen = false; setTrayOpen(false); toggle.setAttribute("aria-expanded", "false"); tray.hidden = true;
    section.className = section.className.replace(/ is-open/g, "");
    if (toggle.focus) toggle.focus();
  });
  messages.parentElement.insertBefore(section, messages);
  refreshIcons();
  if (focusedToggle && toggle.focus) toggle.focus();
}

function handlePairResultStatus(msg) {
  if (!msg || msg.sessionId !== store.get("activeSessionId")) return false;
  statusGeneration++;
  store.set({ pairResultStatus: Array.isArray(msg.items) ? msg.items : [] });
  renderPairResultStatus();
  return true;
}

function clearPairResultStatus() {
  statusGeneration++;
  setTrayOpen(false);
  store.set({ pairResultStatus: [] });
  renderPairResultStatus();
}

export { clearPairResultStatus, handlePairResultStatus, renderPairResultStatus };
