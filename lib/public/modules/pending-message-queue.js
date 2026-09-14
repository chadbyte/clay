import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { escapeHtml } from './utils.js';
import { refreshIcons } from './icons.js';
import { activeQueueItems, moveQueueId, matchesQueueContext, canApplyQueueRevision } from './pending-message-queue-model.js';
import { imageSrc, imageDraft, openImagePreview, chooseImages } from './pending-message-image-editor.js';

var queueEl = null;
var initialized = false;
var requestCounter = 0;
var editGenerationCounter = 0;

function emptyQueue() {
  return { projectSlug: null, sessionId: null, revision: 0, paused: false, items: [], loading: false, error: "" };
}

function context() {
  var state = store.snap();
  return {
    connected: !!state.connected,
    projectSlug: state.currentSlug || null,
    sessionId: state.activeSessionId || null,
    accountId: state.myUserId || "default",
    enabled: !!state.connected && !!state.currentSlug && !!state.activeSessionId && state.activeSessionMode !== "tui" && !state.dmMode && !state.mateProjectSlug,
  };
}

function sameId(a, b) { return String(a) === String(b); }
function sameContext(a, b) { return !!a && !!b && a.projectSlug === b.projectSlug && sameId(a.sessionId, b.sessionId) && a.accountId === b.accountId; }
function currentQueue() { return store.get('pendingMessageQueue') || emptyQueue(); }

function isOwn(item) {
  if (!store.get('isMultiUserMode')) return true;
  return !!item && String(item.actorId) === String(store.get('myUserId'));
}

function isEditableItem(id) {
  var items = currentQueue().items || [];
  for (var i = 0; i < items.length; i++) if (items[i].id === id) return items[i].state === "pending" && isOwn(items[i]);
  return false;
}

function send(message) {
  var socket = getWs();
  if (!socket || socket.readyState !== 1) return false;
  socket.send(JSON.stringify(message));
  return true;
}

function nextRequestId(kind) {
  requestCounter++;
  return "pending-" + kind + "-" + Date.now().toString(36) + "-" + requestCounter;
}

function nextEditGeneration() {
  editGenerationCounter++;
  return editGenerationCounter;
}

function updateEdit(update) {
  var edit = store.get('pendingMessageQueueEdit');
  if (!edit) return;
  var next = Object.assign({}, edit, update);
  if (!Object.prototype.hasOwnProperty.call(update || {}, "error")) next.error = "";
  next.generation = nextEditGeneration();
  store.set({ pendingMessageQueueEdit: next });
}

function rememberRequest(kind, extra) {
  var requestId = nextRequestId(kind);
  var requests = Object.assign({}, store.get('pendingMessageQueueRequests') || {});
  requests[requestId] = Object.assign({ kind: kind, context: context() }, extra || {});
  store.set({ pendingMessageQueueRequests: requests });
  return requestId;
}

function forgetRequest(requestId) {
  var requests = Object.assign({}, store.get('pendingMessageQueueRequests') || {});
  var request = requests[requestId] || null;
  delete requests[requestId];
  store.set({ pendingMessageQueueRequests: requests });
  return request;
}

export function requestPendingMessages(preserveError) {
  var target = context();
  if (!target.enabled) return false;
  var requestId = rememberRequest("get");
  store.set({ pendingMessageQueue: Object.assign({}, currentQueue(), { projectSlug: target.projectSlug, sessionId: target.sessionId, loading: true, error: preserveError ? currentQueue().error : "" }) });
  return send({ type: "pending_message_get", projectSlug: target.projectSlug, sessionId: target.sessionId, requestId: requestId });
}

function sendMutation(kind, fields) {
  var target = context();
  var queue = currentQueue();
  if (!target.enabled || queue.projectSlug !== target.projectSlug || !sameId(queue.sessionId, target.sessionId)) return false;
  var requestDetails = { itemId: fields.id || null };
  if (kind === "edit") {
    var edit = store.get('pendingMessageQueueEdit');
    requestDetails.editText = fields.message && fields.message.text;
    requestDetails.editImages = JSON.stringify(fields.message && fields.message.images || []);
    requestDetails.editGeneration = edit && edit.id === fields.id ? edit.generation : null;
  }
  var requestId = rememberRequest(kind, requestDetails);
  var message = Object.assign({
    type: "pending_message_" + kind,
    projectSlug: target.projectSlug,
    sessionId: target.sessionId,
    revision: queue.revision,
    requestId: requestId,
  }, fields);
  if (!send(message)) {
    forgetRequest(requestId);
    return false;
  }
  return true;
}

function applyCanonical(result) {
  var target = context();
  if (!result || result.projectSlug !== target.projectSlug || !sameId(result.sessionId, target.sessionId)) return false;
  var queue = currentQueue();
  if (queue.projectSlug === result.projectSlug && sameId(queue.sessionId, result.sessionId) && !canApplyQueueRevision(queue.revision, result.revision)) return false;
  var nextEdit = editAfterQueueTransition(Array.isArray(result.items) ? result.items : queue.items || []);
  var update = { pendingMessageQueue: {
    projectSlug: result.projectSlug,
    sessionId: result.sessionId,
    revision: Number(result.revision) || 0,
    paused: result.paused === true,
    items: Array.isArray(result.items) ? result.items : queue.items || [],
    loading: false,
    error: "",
  } };
  if (nextEdit) update.pendingMessageQueueEdit = nextEdit;
  store.set(update);
  return true;
}

function editAfterQueueTransition(items) {
  var edit = store.get('pendingMessageQueueEdit');
  if (!edit) return null;
  for (var i = 0; i < items.length; i++) {
    if (items[i].id === edit.id && items[i].state !== "pending") return Object.assign({}, edit, { token: nextEditGeneration(), pendingReads: 0 });
  }
  return null;
}

function conflict(request, error) {
  var edit = store.get('pendingMessageQueueEdit');
  var update = { pendingMessageQueue: Object.assign({}, currentQueue(), { loading: false, error: error || "Queue changed. Refreshed the latest order." }) };
  if (request && request.kind === "edit" && edit && edit.id === request.itemId) update.pendingMessageQueueEdit = Object.assign({}, edit, { error: error || "Queue changed. Review your edit and save again." });
  store.set(update);
  requestPendingMessages(true);
}

export function handlePendingMessageQueueMessage(msg) {
  var types = ["pending_message_result", "message_queued", "pending_message_queued", "pending_message_state", "pending_message_claimed", "pending_message_consumed"];
  if (!msg || types.indexOf(msg.type) < 0) return false;
  var target = context();
  if (msg.type === "pending_message_result") {
    var request = forgetRequest(msg.requestId);
    if (!request || !sameContext(request.context, target)) return true;
    var result = msg.result || {};
    if (!matchesQueueContext(result, target.projectSlug, target.sessionId)) return true;
    if (!result.ok) {
      if (request.kind === "get") {
        store.set({ pendingMessageQueue: Object.assign({}, currentQueue(), { loading: false, error: result.error || "Queue update failed" }) });
        return true;
      }
      conflict(request, result.error || "Queue update failed");
      return true;
    }
    applyCanonical(result);
    if (request.kind === "edit") {
      var currentEdit = store.get('pendingMessageQueueEdit');
      if (currentEdit && currentEdit.id === request.itemId && currentEdit.text === request.editText && (!Object.prototype.hasOwnProperty.call(request, "editImages") || JSON.stringify(currentEdit.images || []) === request.editImages) && currentEdit.generation === request.editGeneration) {
        store.set({ pendingMessageQueueEdit: null });
      }
    }
    return true;
  }
  if (msg.projectSlug !== target.projectSlug || !sameId(msg.sessionId, target.sessionId)) return true;
  var queue = currentQueue();
  if (msg.type === "message_queued") {
    if (Number(msg.revision) > Number(queue.revision)) requestPendingMessages();
    return true;
  }
  if (!canApplyQueueRevision(queue.revision, msg.revision)) return true;
  if (msg.type === "pending_message_state") {
    applyCanonical(msg);
    return true;
  }
  var items = (queue.items || []).slice();
  if (msg.type === "pending_message_queued" && msg.item) {
    var found = false;
    items = items.map(function (item) { if (item.id === msg.item.id) { found = true; return msg.item; } return item; });
    if (!found) items.push(msg.item);
  } else {
    items = items.map(function (item) {
      if (item.id !== msg.id) return item;
      return Object.assign({}, item, { state: msg.state || (msg.type === "pending_message_claimed" ? "claimed" : item.state) });
    });
  }
  var nextEdit = editAfterQueueTransition(items);
  var update = { pendingMessageQueue: Object.assign({}, queue, { projectSlug: msg.projectSlug, sessionId: msg.sessionId, revision: Number(msg.revision) || queue.revision, paused: msg.paused === true, items: items, loading: false, error: "" }) };
  if (nextEdit) update.pendingMessageQueueEdit = nextEdit;
  store.set(update);
  return true;
}

function ownedPendingIds() {
  return activeQueueItems(currentQueue().items).filter(function (item) { return item.state === "pending" && isOwn(item); }).map(function (item) { return item.id; });
}

function reorder(id, direction, targetId) {
  var ids = ownedPendingIds();
  if (ids.indexOf(id) < 0) return;
  var next = moveQueueId(ids, id, direction, targetId);
  if (next.join("\n") === ids.join("\n")) return;
  sendMutation("reorder", { ids: next });
}

function beginEdit(id) {
  var items = currentQueue().items || [];
  for (var i = 0; i < items.length; i++) {
    if (items[i].id === id && items[i].state === "pending" && isOwn(items[i])) {
      store.set({ pendingMessageQueueEdit: { id: id, token: nextEditGeneration(), text: items[i].message.text || "", images: (items[i].message.images || []).map(imageDraft), error: "", pendingReads: 0, generation: nextEditGeneration() } });
      var row = findRow(id);
      var editor = row && row.querySelector(".pending-message-editor");
      if (editor) {
        focusWithoutScroll(editor);
        editor.setSelectionRange(editor.value.length, editor.value.length);
      }
      return;
    }
  }
}

function saveEdit(id) {
  var edit = store.get('pendingMessageQueueEdit');
  if (!edit || edit.id !== id || !isEditableItem(id)) return;
  if (edit.pendingReads) return;
  store.set({ pendingMessageQueueFocusReturn: { id: id, action: "edit" } });
  sendMutation("edit", { id: id, message: { text: edit.text, images: edit.images || [] } });
}

function findRow(id) {
  if (!queueEl) return null;
  var rows = queueEl.querySelectorAll("[data-pending-id]");
  for (var i = 0; i < rows.length; i++) if (rows[i].dataset.pendingId === id) return rows[i];
  return null;
}

function focusWithoutScroll(element) {
  if (!element) return;
  try { element.focus({ preventScroll: true }); }
  catch (e) { element.focus(); }
}

function captureFocus() {
  var active = document.activeElement;
  if (!active || !queueEl || !queueEl.contains(active)) return null;
  var row = active.closest("[data-pending-id]");
  var id = row && row.dataset.pendingId;
  if (!id) return null;
  if (active.classList.contains("pending-message-editor")) {
    return { kind: "editor", id: id, start: active.selectionStart, end: active.selectionEnd, direction: active.selectionDirection };
  }
  return { kind: "action", id: id, action: active.dataset.action || null };
}

function restoreFocus(focus) {
  var target = null;
  var row = focus && findRow(focus.id);
  if (row && focus.kind === "editor") target = row.querySelector(".pending-message-editor");
  else if (row && focus.action) target = row.querySelector('[data-action="' + focus.action + '"]');
  var focusReturn = store.get('pendingMessageQueueFocusReturn');
  if (!target && focusReturn) {
    var returnRow = findRow(focusReturn.id);
    if (returnRow) target = returnRow.querySelector('[data-action="' + focusReturn.action + '"]');
    store.set({ pendingMessageQueueFocusReturn: null });
  }
  if (!target) return;
  focusWithoutScroll(target);
  if (focus && focus.kind === "editor" && target.classList.contains("pending-message-editor")) {
    var length = target.value.length;
    target.setSelectionRange(Math.min(focus.start, length), Math.min(focus.end, length), focus.direction || "none");
  }
}

function attachmentLabel(item) {
  var message = item.message || {};
  var parts = [];
  if (message.images && message.images.length) parts.push(message.images.length + " image" + (message.images.length === 1 ? "" : "s"));
  if (message.pastes && message.pastes.length) parts.push(message.pastes.length + " paste" + (message.pastes.length === 1 ? "" : "s"));
  return parts.join(" · ");
}

function renderItem(item, index) {
  var own = isOwn(item);
  var editing = store.get('pendingMessageQueueEdit');
  var isEditing = editing && editing.id === item.id && item.state === "pending" && own;
  var attribution = own ? "You" : (item.actorName || "Collaborator");
  var attachment = attachmentLabel(item);
  var text = (item.message && item.message.text || "").trim() || "Attachment-only message";
  var html = '<div class="pending-message-chip' + (item.state === "claimed" ? ' is-claimed' : '') + '" data-pending-id="' + escapeHtml(item.id) + '">';
  html += '<span class="pending-message-number" aria-hidden="true">' + (index + 1) + '</span>';
  if (own && item.state === "pending") html += '<button class="pending-message-drag" type="button" data-action="drag" aria-label="Reorder queued message ' + (index + 1) + '" title="Drag, or use arrow keys to reorder">' + '<i data-lucide="grip-vertical"></i></button>';
  else html += '<span class="pending-message-drag is-static"><i data-lucide="' + (item.state === "claimed" ? "loader-circle" : "lock-keyhole") + '"></i></span>';
  html += '<div class="pending-message-content">';
  if (isEditing) {
    html += '<textarea class="pending-message-editor" rows="2" aria-label="Edit queued message">' + escapeHtml(editing.text) + '</textarea>';
    html += '<div class="pending-message-image-editor" aria-label="Queued images">';
    var editImages = editing.images || [];
    for (var ei = 0; ei < editImages.length; ei++) {
      var editSrc = imageSrc(editImages[ei]);
      html += '<span class="pending-message-image-item"><button type="button" class="pending-message-image-thumb" data-action="preview-image" data-image-src="' + escapeHtml(editSrc) + '" aria-label="Preview image ' + (ei + 1) + '"><img src="' + escapeHtml(editSrc) + '" alt="Queued image ' + (ei + 1) + '"></button><button type="button" data-action="replace-image" data-image-index="' + ei + '" aria-label="Replace image ' + (ei + 1) + '"' + (editing.pendingReads ? ' disabled' : '') + '>Replace</button><button type="button" data-action="remove-image" data-image-index="' + ei + '" aria-label="Remove image ' + (ei + 1) + '"' + (editing.pendingReads ? ' disabled' : '') + '>×</button></span>';
    }
    html += '<button type="button" class="pending-message-add-image" data-action="add-image"' + (editing.pendingReads ? ' disabled' : '') + '>+ Add images</button></div>';
    if (editing.pendingReads) html += '<div class="pending-message-image-reading">Reading image…</div>';
    if (editing.error) html += '<div class="pending-message-error" role="alert">' + escapeHtml(editing.error) + '</div>';
    html += '<div class="pending-message-edit-actions"><button type="button" data-action="edit-cancel">Cancel</button><button type="button" class="is-primary" data-action="edit-save"' + (editing.pendingReads ? ' disabled' : '') + '>Save</button></div>';
  } else {
    html += '<div class="pending-message-preview" title="' + escapeHtml(text) + '">' + escapeHtml(text) + '</div>';
    if (item.message && item.message.images && item.message.images.length) {
      html += '<div class="pending-message-image-strip">';
      for (var pi = 0; pi < item.message.images.length; pi++) html += '<button type="button" class="pending-message-image-thumb" data-action="preview-image" data-image-src="' + escapeHtml(imageSrc(item.message.images[pi])) + '" aria-label="Preview queued image ' + (pi + 1) + '"><img src="' + escapeHtml(imageSrc(item.message.images[pi])) + '" alt="Queued image ' + (pi + 1) + '"></button>';
      html += '</div>';
    }
    html += '<div class="pending-message-meta"><span>' + escapeHtml(attribution) + '</span>';
    if (attachment) html += '<span>' + escapeHtml(attachment) + '</span>';
    if (item.state === "claimed") html += '<span class="pending-message-sending">Sending</span>';
    html += '</div>';
  }
  html += '</div><div class="pending-message-actions">';
  if (!isEditing && own && item.state === "pending") html += '<button type="button" data-action="edit" aria-label="Edit queued message" title="Edit"><i data-lucide="pencil"></i></button>';
  if (!isEditing && own) html += '<button type="button" data-action="cancel" aria-label="Cancel queued message" title="Cancel"><i data-lucide="x"></i></button>';
  html += '</div></div>';
  return html;
}

function render() {
  if (!queueEl) queueEl = document.getElementById("pending-message-queue");
  if (!queueEl) return;
  var target = context();
  var queue = currentQueue();
  var items = activeQueueItems(queue.items);
  var focus = captureFocus();
  var visible = target.enabled && queue.projectSlug === target.projectSlug && sameId(queue.sessionId, target.sessionId) && items.length > 0;
  queueEl.classList.toggle("hidden", !visible);
  if (!visible) { queueEl.innerHTML = ""; return; }
  var html = '<div class="pending-message-head"><div><span class="pending-message-eyebrow">Next up</span><span class="pending-message-count">' + items.length + '</span></div>';
  if (queue.paused) html += '<button type="button" class="pending-message-resume" data-action="resume"><i data-lucide="play"></i><span>Resume queue</span></button>';
  html += '</div>';
  if (queue.error) html += '<div class="pending-message-banner-error" role="alert">' + escapeHtml(queue.error) + '</div>';
  html += '<div class="pending-message-list">';
  for (var i = 0; i < items.length; i++) html += renderItem(items[i], i);
  html += '</div>';
  queueEl.innerHTML = html;
  refreshIcons();
  restoreFocus(focus);
}

function bindEvents() {
  queueEl.addEventListener("input", function (event) {
    if (!event.target.classList.contains("pending-message-editor")) return;
    var edit = store.get('pendingMessageQueueEdit');
    if (edit) store.set({ pendingMessageQueueEdit: Object.assign({}, edit, { text: event.target.value, error: "", generation: nextEditGeneration() }) });
  });
  queueEl.addEventListener("click", function (event) {
    var button = event.target.closest("[data-action]");
    if (!button) return;
    var row = button.closest("[data-pending-id]");
    var id = row && row.dataset.pendingId;
    var action = button.dataset.action;
    if (action === "preview-image") openImagePreview(button.dataset.imageSrc, "Queued image preview");
    else if (action === "add-image") chooseImages(id, null, { getEdit: function () { return store.get('pendingMessageQueueEdit'); }, getContext: context, sameContext: sameContext, isEditable: isEditableItem, setEdit: updateEdit });
    else if (action === "replace-image") chooseImages(id, Number(button.dataset.imageIndex), { getEdit: function () { return store.get('pendingMessageQueueEdit'); }, getContext: context, sameContext: sameContext, isEditable: isEditableItem, setEdit: updateEdit });
    else if (action === "remove-image") {
      var currentEdit = store.get('pendingMessageQueueEdit');
      if (currentEdit && currentEdit.id === id && isEditableItem(id) && !currentEdit.pendingReads) updateEdit({ images: (currentEdit.images || []).filter(function (image, imageIndex) { return imageIndex !== Number(button.dataset.imageIndex); }) });
    } else if (action === "edit") beginEdit(id);
    else if (action === "edit-cancel") store.set({ pendingMessageQueueFocusReturn: { id: id, action: "edit" }, pendingMessageQueueEdit: null });
    else if (action === "edit-save") saveEdit(id);
    else if (action === "cancel") sendMutation("cancel", { id: id });
    else if (action === "resume") sendMutation("resume", {});
  });
  queueEl.addEventListener("keydown", function (event) {
    var handle = event.target.closest('[data-action="drag"]');
    if (!handle || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
    event.preventDefault();
    var row = handle.closest("[data-pending-id]");
    reorder(row.dataset.pendingId, event.key === "ArrowUp" ? -1 : 1, null);
  });
  queueEl.addEventListener("pointerdown", function (event) {
    var handle = event.target.closest('[data-action="drag"]');
    if (!handle) return;
    var row = handle.closest("[data-pending-id]");
    handle.setPointerCapture(event.pointerId);
    store.set({ pendingMessageQueueDrag: { id: row.dataset.pendingId, pointerId: event.pointerId, targetId: null } });
    row.classList.add("is-dragging");
  });
  queueEl.addEventListener("pointermove", function (event) {
    var drag = store.get('pendingMessageQueueDrag');
    if (!drag || drag.pointerId !== event.pointerId) return;
    var target = document.elementFromPoint(event.clientX, event.clientY);
    var row = target && target.closest("[data-pending-id]");
    var targetId = row && row.dataset.pendingId !== drag.id ? row.dataset.pendingId : null;
    queueEl.querySelectorAll(".is-drop-target").forEach(function (node) { node.classList.remove("is-drop-target"); });
    if (targetId && ownedPendingIds().indexOf(targetId) >= 0) row.classList.add("is-drop-target");
    store.set({ pendingMessageQueueDrag: Object.assign({}, drag, { targetId: targetId }) });
  });
  function cleanupDrag(event) {
    var drag = store.get('pendingMessageQueueDrag');
    if (!drag || drag.pointerId !== event.pointerId) return null;
    store.set({ pendingMessageQueueDrag: null });
    queueEl.querySelectorAll(".is-dragging, .is-drop-target").forEach(function (node) { node.classList.remove("is-dragging", "is-drop-target"); });
    return drag;
  }
  function finishDrag(event) {
    var drag = cleanupDrag(event);
    if (!drag) return;
    if (drag.targetId && ownedPendingIds().indexOf(drag.targetId) >= 0) reorder(drag.id, 0, drag.targetId);
  }
  queueEl.addEventListener("pointerup", finishDrag);
  queueEl.addEventListener("pointercancel", cleanupDrag);
  queueEl.addEventListener("lostpointercapture", cleanupDrag);
}

export function initPendingMessageQueue() {
  if (initialized) return;
  initialized = true;
  queueEl = document.getElementById("pending-message-queue");
  if (!queueEl) return;
  bindEvents();
  store.subscribe(function (state, previous) {
    var contextChanged = state.connected !== previous.connected || state.currentSlug !== previous.currentSlug || state.activeSessionId !== previous.activeSessionId || state.activeSessionMode !== previous.activeSessionMode || state.dmMode !== previous.dmMode || state.mateProjectSlug !== previous.mateProjectSlug || state.myUserId !== previous.myUserId || state.isMultiUserMode !== previous.isMultiUserMode;
    if (contextChanged) {
      store.set({ pendingMessageQueue: emptyQueue(), pendingMessageQueueRequests: {}, pendingMessageQueueEdit: null, pendingMessageQueueDrag: null, pendingMessageQueueFocusReturn: null });
      if (context().enabled) requestPendingMessages();
      return;
    }
    var edit = state.pendingMessageQueueEdit;
    var previousEdit = previous.pendingMessageQueueEdit;
    var editNeedsRender = edit !== previousEdit && (!edit || !previousEdit || edit.id !== previousEdit.id || edit.error !== previousEdit.error || edit.images !== previousEdit.images || edit.pendingReads !== previousEdit.pendingReads);
    if (state.pendingMessageQueue !== previous.pendingMessageQueue || editNeedsRender) render();
  });
  render();
}
