// app-message-cards.js - Non-stream project message and notice rendering.

import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { escapeHtml, copyToClipboard } from './utils.js';
import { renderMarkdown, highlightCodeBlocks } from './markdown.js';
import { iconHtml, refreshIcons } from './icons.js';
import { userAvatarUrl } from './avatar.js';
import { showImageModal } from './app-misc.js';
import { showPasteModal } from './paste-modal.js';
import { addToMessages, scrollToBottom, forceScrollToBottom, getMsgTime, shouldGroupMessage, getTurnCounter, setTurnCounter, VENDOR_AVATARS } from './chat-render-runtime.js';

export function addUserMessage(text, images, pastes, fromUserId, fromUserName, delegatedMeta) {
  if (!text && (!images || images.length === 0) && (!pastes || pastes.length === 0)) return;
  var myUserId = store.get('myUserId');
  var isDelegated = !!delegatedMeta;
  var isOtherUser = isDelegated || (fromUserId && fromUserId !== myUserId);
  var div = document.createElement("div");
  div.className = "msg-user" + (isOtherUser ? " msg-user-other" : "");
  if (isDelegated) div.classList.add("msg-user-delegated");
  var turn = getTurnCounter() + 1;
  setTurnCounter(turn);
  div.dataset.turn = turn;
  if (shouldGroupMessage("msg-user")) div.classList.add("grouped");
  var bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.dir = "auto";

  if (isDelegated) {
    var cardHead = document.createElement("div");
    cardHead.className = "delegated-card-head";
    var cardAvi = document.createElement("img");
    cardAvi.className = "delegated-card-avatar";
    cardAvi.src = VENDOR_AVATARS[delegatedMeta.delegatedByVendor] || VENDOR_AVATARS.claude;
    cardAvi.alt = "";
    cardHead.appendChild(cardAvi);
    var cardHeadText = document.createElement("div");
    cardHeadText.className = "delegated-card-headtext";
    var eyebrow = document.createElement("span");
    eyebrow.className = "delegated-card-eyebrow";
    eyebrow.textContent = "Delegated task";
    cardHeadText.appendChild(eyebrow);
    var cardFrom = document.createElement("span");
    cardFrom.className = "delegated-card-from";
    cardFrom.textContent = delegatedMeta.delegatedByTitle || "Driver";
    cardHeadText.appendChild(cardFrom);
    cardHead.appendChild(cardHeadText);
    var cardTime = document.createElement("span");
    cardTime.className = "delegated-card-time";
    cardTime.textContent = getMsgTime();
    cardHead.appendChild(cardTime);
    bubble.appendChild(cardHead);
  }

  if (images && images.length > 0) {
    var imgRow = document.createElement("div");
    imgRow.className = "bubble-images";
    for (var i = 0; i < images.length; i++) {
      var img = document.createElement("img");
      if (images[i].url) img.src = images[i].url;
      else if (images[i].data) img.src = "data:" + images[i].mediaType + ";base64," + images[i].data;
      img.loading = "lazy";
      img.className = "bubble-img";
      img.addEventListener("click", function () { showImageModal(this.src); });
      img.addEventListener("error", function () {
        var placeholder = document.createElement("div");
        placeholder.className = "bubble-img-expired";
        placeholder.textContent = "Image deleted";
        this.parentNode.replaceChild(placeholder, this);
      });
      imgRow.appendChild(img);
    }
    bubble.appendChild(imgRow);
  }

  if (pastes && pastes.length > 0) {
    var pasteRow = document.createElement("div");
    pasteRow.className = "bubble-pastes";
    for (var p = 0; p < pastes.length; p++) {
      (function (pasteText) {
        var chip = document.createElement("div");
        chip.className = "bubble-paste";
        var preview = pasteText.substring(0, 60).replace(/\n/g, " ");
        if (pasteText.length > 60) preview += "...";
        chip.innerHTML = '<span class="bubble-paste-preview">' + escapeHtml(preview) + '</span><span class="bubble-paste-label">PASTED</span>';
        chip.addEventListener("click", function (event) {
          event.stopPropagation();
          showPasteModal(pasteText);
        });
        pasteRow.appendChild(chip);
      })(pastes[p]);
    }
    bubble.appendChild(pasteRow);
  }

  if (text) {
    if (isDelegated) {
      var mdEl = document.createElement("div");
      mdEl.className = "md-content delegated-brief";
      mdEl.innerHTML = renderMarkdown(text);
      highlightCodeBlocks(mdEl);
      bubble.appendChild(mdEl);
    } else {
      var textEl = document.createElement("span");
      textEl.textContent = text;
      bubble.appendChild(textEl);
    }
  }

  var cachedAllUsers = store.get('cachedAllUsers');
  var targetUser;
  var displayName;
  if (isDelegated) {
    targetUser = null;
    displayName = "from " + (delegatedMeta.delegatedByTitle || "Driver");
  } else if (isOtherUser) {
    targetUser = cachedAllUsers.find(function (user) { return user.id === fromUserId; });
    displayName = fromUserName || (targetUser && (targetUser.displayName || targetUser.username)) || "User";
  } else {
    targetUser = cachedAllUsers.find(function (user) { return user.id === myUserId; });
    displayName = document.body.dataset.myDisplayName || "";
    if (!displayName) displayName = (targetUser && (targetUser.displayName || targetUser.username)) || "Me";
  }

  var avatar = document.createElement("img");
  avatar.className = "dm-bubble-avatar" + (isOtherUser ? " dm-bubble-avatar-other" : " dm-bubble-avatar-me");
  avatar.src = isDelegated
    ? (VENDOR_AVATARS[delegatedMeta.delegatedByVendor] || VENDOR_AVATARS.claude)
    : isOtherUser
    ? userAvatarUrl(targetUser || { id: fromUserId }, 36)
    : (document.body.dataset.myAvatarUrl || userAvatarUrl(targetUser || { id: myUserId }, 36));
  div.appendChild(avatar);

  var contentWrap = document.createElement("div");
  contentWrap.className = "dm-bubble-content";
  var header = document.createElement("div");
  header.className = "dm-bubble-header";
  var nameSpan = document.createElement("span");
  nameSpan.className = "dm-bubble-name";
  nameSpan.textContent = displayName;
  header.appendChild(nameSpan);
  var timeSpan = document.createElement("span");
  timeSpan.className = "dm-bubble-time";
  timeSpan.textContent = getMsgTime();
  header.appendChild(timeSpan);
  contentWrap.appendChild(header);
  contentWrap.appendChild(bubble);
  div.appendChild(contentWrap);

  var actions = document.createElement("div");
  actions.className = "msg-actions";
  actions.innerHTML =
    '<span class="msg-action-time">' + getMsgTime() + '</span>' +
    '<button class="msg-action-btn msg-action-copy" type="button" title="Copy">' + iconHtml("copy") + '</button>' +
    '<button class="msg-action-btn msg-action-fork" type="button" title="Fork">' + iconHtml("git-branch") + '</button>' +
    (((store.get('vendorCapabilities') || {}).rewind !== false) ? '<button class="msg-action-btn msg-action-rewind msg-user-rewind-btn" type="button" title="Rewind">' + iconHtml("rotate-ccw") + '</button>' : '') +
    '<button class="msg-action-btn msg-action-hidden msg-action-edit" type="button" title="Edit">' + iconHtml("pencil") + '</button>';
  div.appendChild(actions);
  actions.querySelector(".msg-action-copy").addEventListener("click", function () {
    var self = this;
    copyToClipboard(text || "");
    self.innerHTML = iconHtml("check");
    refreshIcons();
    setTimeout(function () { self.innerHTML = iconHtml("copy"); refreshIcons(); }, 1200);
  });

  addToMessages(div);
  refreshIcons();
  forceScrollToBottom(div);
}

export function addSystemMessage(text, isError) {
  var div = document.createElement("div");
  div.className = "sys-msg" + (isError ? " error" : "");
  div.innerHTML = '<span class="sys-text"></span>';
  div.querySelector(".sys-text").textContent = text;
  addToMessages(div);
  scrollToBottom();
}

export function addConflictMessage(msg) {
  var div = document.createElement("div");
  div.className = "conflict-msg";
  var header = document.createElement("div");
  header.className = "conflict-header";
  header.textContent = msg.text || "Another Claude Code process is already running.";
  div.appendChild(header);
  var hint = document.createElement("div");
  hint.className = "conflict-hint";
  hint.textContent = "Kill the conflicting process to continue, or use the existing Claude Code session.";
  div.appendChild(hint);

  for (var i = 0; i < msg.processes.length; i++) {
    var process = msg.processes[i];
    var row = document.createElement("div");
    row.className = "conflict-process";
    var info = document.createElement("span");
    info.className = "conflict-pid";
    info.textContent = "PID " + process.pid;
    row.appendChild(info);
    var command = document.createElement("code");
    command.className = "conflict-cmd";
    command.textContent = process.command.length > 80 ? process.command.substring(0, 80) + "..." : process.command;
    command.title = process.command;
    row.appendChild(command);
    var killBtn = document.createElement("button");
    killBtn.className = "conflict-kill-btn";
    killBtn.textContent = "Kill Process";
    killBtn.setAttribute("data-pid", process.pid);
    killBtn.addEventListener("click", function () {
      var pid = parseInt(this.getAttribute("data-pid"), 10);
      getWs().send(JSON.stringify({ type: "kill_process", pid: pid }));
      this.disabled = true;
      this.textContent = "Killing...";
    });
    row.appendChild(killBtn);
    div.appendChild(row);
  }
  addToMessages(div);
  scrollToBottom();
}

export function addContextOverflowMessage(msg) {
  var div = document.createElement("div");
  div.className = "context-overflow-msg";
  var header = document.createElement("div");
  header.className = "context-overflow-header";
  header.textContent = msg.text || "Conversation too long to continue.";
  div.appendChild(header);
  var hint = document.createElement("div");
  hint.className = "context-overflow-hint";
  hint.textContent = "The conversation has exceeded the model's context limit. Please start a new conversation to continue.";
  div.appendChild(hint);
  var button = document.createElement("button");
  button.className = "context-overflow-btn";
  button.textContent = "New Conversation";
  button.addEventListener("click", function () {
    getWs().send(JSON.stringify({ type: "new_session" }));
  });
  div.appendChild(button);
  addToMessages(div);
  scrollToBottom();
}
