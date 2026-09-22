import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { showConfirm } from './app-misc.js';

var statusGeneration = 0;

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

function renderPairResultStatus() {
  var existing = document.getElementById("pair-result-status");
  if (existing) existing.remove();
  var items = store.get("pairResultStatus") || [];
  if (!items.length) return;
  var messages = document.getElementById("messages");
  if (!messages || !messages.parentElement) return;
  var section = document.createElement("section");
  section.id = "pair-result-status";
  section.className = "pair-result-status";
  section.setAttribute("role", "status");
  for (var i = 0; i < items.length; i++) {
    var item = items[i], card = document.createElement("div");
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
      var button = document.createElement("button");
      button.type = "button"; button.className = "confirm-btn confirm-ok pair-result-status-retry"; button.textContent = "Retry delivery";
      button.addEventListener("click", retry.bind(null, item));
      card.appendChild(button);
    }
    section.appendChild(card);
  }
  messages.parentElement.insertBefore(section, messages);
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
  store.set({ pairResultStatus: [] });
  renderPairResultStatus();
}

export { clearPairResultStatus, handlePairResultStatus, renderPairResultStatus };
