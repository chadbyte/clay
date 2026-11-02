import { showToast } from './utils.js';
import { showEmailSetupModal } from './personal-email-editor.js';
export { showEmailSetupModal, handleEmailTestResult, handleEmailAddResult, handleEmailRemoveResult } from './personal-email-editor.js';
// Context Sources — attach terminal output, browser tabs, and email accounts as context for Claude

var ctx = null;
var activeSourceIds = new Set();
var terminalList = []; // synced from terminal module's term_list
var browserTabList = []; // synced from Chrome extension via postMessage
var emailAccountList = []; // synced from server via email_accounts_list
var emailProviders = {}; // provider presets from server
var emailUnreadCounts = {}; // accountId -> unread count

export function initContextSources(_ctx) {
  ctx = _ctx;

  var addBtn = document.getElementById("context-sources-add");
  var picker = document.getElementById("context-sources-picker");
  // Suppress tooltip when the picker is open
  if (addBtn) addBtn.setAttribute("data-tip-suppress-when-open", "#context-sources-picker");

  addBtn.addEventListener("click", function(e) {
    e.stopPropagation();
    if (picker.classList.contains("hidden")) {
      renderPicker();
      picker.classList.remove("hidden");
      document.addEventListener("click", closePicker, true);
    } else {
      closePicker();
    }
  });

  picker.addEventListener("click", function(e) {
    e.stopPropagation();
  });
}

function closePicker() {
  var picker = document.getElementById("context-sources-picker");
  if (picker) picker.classList.add("hidden");
  document.removeEventListener("click", closePicker, true);
  // Also close mobile bottom sheet if open
  var moreSheet = document.getElementById("input-more-sheet");
  if (moreSheet && moreSheet.classList.contains("open")) {
    moreSheet.classList.remove("open");
    setTimeout(function () { moreSheet.classList.add("hidden"); }, 250);
  }
}

// Re-render all open picker surfaces (desktop popover and mobile bottom sheet)
function renderAllOpen() {
  var picker = document.getElementById("context-sources-picker");
  if (picker && !picker.classList.contains("hidden")) renderPicker();
  var moreSheet = document.getElementById("input-more-sheet");
  if (moreSheet && moreSheet.classList.contains("open")) renderPicker("-mobile");
}

// Restore state from server
export function handleContextSourcesState(msg) {
  var saved = msg.active || [];
  activeSourceIds = new Set(saved);
  renderChips();
}

// Save active sources to server
function saveToServer() {
  if (ctx && ctx.ws && ctx.connected) {
    ctx.ws.send(JSON.stringify({
      type: "context_sources_save",
      active: Array.from(activeSourceIds)
    }));
  }
}

// Called when term_list arrives from server
export function updateTerminalList(terminals) {
  terminalList = terminals || [];

  // Remove active sources that no longer exist
  var changed = false;
  for (var id of activeSourceIds) {
    if (id.startsWith("term:")) {
      var termId = parseInt(id.split(":")[1], 10);
      var found = false;
      for (var i = 0; i < terminalList.length; i++) {
        if (terminalList[i].id === termId) { found = true; break; }
      }
      if (!found) {
        activeSourceIds.delete(id);
        changed = true;
      }
    }
  }

  if (changed) saveToServer();
  renderChips();

  renderAllOpen();
}

// Called when Chrome extension sends tab list via postMessage
export function updateBrowserTabList(tabs) {
  browserTabList = tabs || [];

  // Remove active tab sources that no longer exist
  var changed = false;
  for (var id of activeSourceIds) {
    if (id.startsWith("tab:")) {
      var tabId = parseInt(id.split(":")[1], 10);
      var found = false;
      for (var i = 0; i < browserTabList.length; i++) {
        if (browserTabList[i].id === tabId) { found = true; break; }
      }
      if (!found) {
        activeSourceIds.delete(id);
        changed = true;
      }
    }
  }

  if (changed) saveToServer();
  renderChips();

  renderAllOpen();
}

// Called when email_accounts_list arrives from server
export function updateEmailAccountList(msg) {
  emailAccountList = msg.accounts || [];
  if (msg.providers) emailProviders = msg.providers;

  // Remove active email sources that no longer exist
  var changed = false;
  for (var id of activeSourceIds) {
    if (id.startsWith("email:")) {
      var accId = id.split(":")[1];
      var found = false;
      for (var i = 0; i < emailAccountList.length; i++) {
        if (emailAccountList[i].id === accId) { found = true; break; }
      }
      if (!found) {
        activeSourceIds.delete(id);
        changed = true;
      }
    }
  }

  if (changed) saveToServer();
  renderChips();

  renderAllOpen();
}

// Called when email_unread_update arrives from server
export function updateEmailUnreadCounts(msg) {
  emailUnreadCounts = msg.unread || {};
  renderChips();

  renderAllOpen();
}

function toggleSource(sourceId) {
  if (activeSourceIds.has(sourceId)) {
    activeSourceIds.delete(sourceId);
  } else {
    activeSourceIds.add(sourceId);
  }
  saveToServer();
  renderChips();
  renderAllOpen();
}

function removeSource(sourceId) {
  activeSourceIds.delete(sourceId);
  saveToServer();
  renderChips();

  renderAllOpen();
}

function buildActiveSourceRow(iconHtml, text) {
  return '<div class="ctx-tip-row">' + iconHtml + '<span>' + escapeHtml(text) + '</span></div>';
}

function getActiveSourceRowsHTML() {
  var rows = [];
  for (var id of activeSourceIds) {
    var parts = id.split(":");
    var type = parts[0];
    var key = parts.slice(1).join(":");
    if (type === "term") {
      for (var i = 0; i < terminalList.length; i++) {
        if (String(terminalList[i].id) === key) {
          rows.push(buildActiveSourceRow(
            '<i data-lucide="square-terminal"></i>',
            terminalList[i].title || ("Terminal " + key)
          ));
          break;
        }
      }
    } else if (type === "tab") {
      var tabId = parseInt(key, 10);
      for (var j = 0; j < browserTabList.length; j++) {
        if (browserTabList[j].id === tabId) {
          var t = browserTabList[j];
          var title = t.title || t.url || "Tab";
          if (title.length > 50) title = title.slice(0, 47) + "...";
          var faviconHtml = t.favIconUrl
            ? '<img src="' + escapeHtml(t.favIconUrl) + '" class="ctx-tip-favicon" onerror="this.style.display=\'none\'">'
            : '<i data-lucide="globe"></i>';
          rows.push(buildActiveSourceRow(faviconHtml, title));
          break;
        }
      }
    } else if (type === "email") {
      for (var k = 0; k < emailAccountList.length; k++) {
        if (emailAccountList[k].id === key) {
          rows.push(buildActiveSourceRow(
            '<i data-lucide="mail"></i>',
            emailAccountList[k].email
          ));
          break;
        }
      }
    }
  }
  return rows;
}

function renderChips() {
  // Update add button — show badge count when sources are active
  var addBtn = document.getElementById("context-sources-add");
  var existingBadge = addBtn.querySelector(".ctx-badge");
  if (activeSourceIds.size > 0) {
    if (!existingBadge) {
      existingBadge = document.createElement("span");
      existingBadge.className = "ctx-badge";
      addBtn.appendChild(existingBadge);
    }
    existingBadge.textContent = activeSourceIds.size;
    var rows = getActiveSourceRowsHTML();
    if (rows.length > 0) {
      var html = '<div class="ctx-tip-header">Active context sources</div>' + rows.join("");
      addBtn.setAttribute("data-tip-html", html);
      addBtn.removeAttribute("data-tip");
    } else {
      addBtn.setAttribute("data-tip", "Add context sources");
      addBtn.removeAttribute("data-tip-html");
    }
    addBtn.removeAttribute("title");
  } else {
    if (existingBadge) existingBadge.remove();
    addBtn.setAttribute("data-tip", "Add context sources");
    addBtn.removeAttribute("data-tip-html");
    addBtn.removeAttribute("title");
  }
}

export function renderPicker(suffix) {
  suffix = suffix || "";
  // --- Terminals section ---
  var termSection = document.getElementById("context-picker-terminals" + suffix);
  if (!termSection) return;
  termSection.innerHTML = "";

  var termLabel = document.createElement("div");
  termLabel.className = "context-picker-section-label";
  termLabel.textContent = "Terminals";
  termSection.appendChild(termLabel);

  if (terminalList.length === 0) {
    var termEmpty = document.createElement("div");
    termEmpty.className = "context-picker-empty";
    termEmpty.textContent = "No terminals open";
    termSection.appendChild(termEmpty);
  } else {
    for (var i = 0; i < terminalList.length; i++) {
      var term = terminalList[i];
      var termSourceId = "term:" + term.id;
      var termActive = activeSourceIds.has(termSourceId);

      var termItem = document.createElement("div");
      termItem.className = "context-picker-item" + (termActive ? " active" : "");
      termItem.setAttribute("data-source-id", termSourceId);

      termItem.innerHTML =
        '<i data-lucide="square-terminal"></i>' +
        '<span>' + escapeHtml(term.title || ("Terminal " + term.id)) + '</span>' +
        '<i data-lucide="check" class="context-picker-check"></i>';

      termItem.addEventListener("click", function() {
        toggleSource(this.getAttribute("data-source-id"));
        if (typeof lucide !== "undefined") lucide.createIcons();
      });

      termSection.appendChild(termItem);
    }
  }

  // --- Browser Tabs section ---
  var tabSection = document.getElementById("context-picker-tabs" + suffix);
  if (!tabSection) return;
  tabSection.innerHTML = "";

  var tabLabel = document.createElement("div");
  tabLabel.className = "context-picker-section-label";
  tabLabel.textContent = "Browser Tabs";
  tabSection.appendChild(tabLabel);

  if (browserTabList.length === 0) {
    // Extension not connected: show notice with setup button
    var notice = document.createElement("div");
    notice.className = "context-picker-ext-notice";
    notice.innerHTML =
      '<span class="context-picker-ext-notice-text">Chrome extension required to access browser tabs.</span>' +
      '<button class="context-picker-ext-btn" type="button"><i data-lucide="puzzle"></i> Setup Extension</button>';
    var setupBtn = notice.querySelector(".context-picker-ext-btn");
    setupBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      closePicker();
      var extPill = document.getElementById("ext-pill");
      if (extPill) extPill.click();
    });
    tabSection.appendChild(notice);
  } else {
    for (var j = 0; j < browserTabList.length; j++) {
      var tab = browserTabList[j];
      var tabSourceId = "tab:" + tab.id;
      var tabActive = activeSourceIds.has(tabSourceId);

      var tabItem = document.createElement("div");
      tabItem.className = "context-picker-item" + (tabActive ? " active" : "");
      tabItem.setAttribute("data-source-id", tabSourceId);

      var tabTitle = tab.title || tab.url || "Tab";
      // Truncate long URLs for display
      var tabDisplay = tabTitle.length > 50 ? tabTitle.slice(0, 47) + "..." : tabTitle;

      var faviconHtml = "";
      if (tab.favIconUrl) {
        faviconHtml = '<img src="' + escapeHtml(tab.favIconUrl) + '" class="context-picker-favicon" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'\'">' +
          '<i data-lucide="globe" style="display:none"></i>';
      } else {
        faviconHtml = '<i data-lucide="globe"></i>';
      }

      tabItem.innerHTML =
        faviconHtml +
        '<span title="' + escapeHtml(tab.url || "") + '">' + escapeHtml(tabDisplay) + '</span>' +
        '<i data-lucide="check" class="context-picker-check"></i>';

      tabItem.addEventListener("click", function() {
        toggleSource(this.getAttribute("data-source-id"));
        if (typeof lucide !== "undefined") lucide.createIcons();
      });

      tabSection.appendChild(tabItem);
    }
  }

  // --- Email Accounts section ---
  var emailSection = document.getElementById("context-picker-email" + suffix);
  if (!emailSection) return;
  emailSection.innerHTML = "";

  var emailLabel = document.createElement("div");
  emailLabel.className = "context-picker-section-label";
  emailLabel.textContent = "Email Accounts";
  emailSection.appendChild(emailLabel);

  if (emailAccountList.length === 0) {
    var emailEmpty = document.createElement("div");
    emailEmpty.className = "context-picker-empty";
    emailEmpty.textContent = "No email accounts connected";
    emailSection.appendChild(emailEmpty);

    var addAccBtn = document.createElement("div");
    addAccBtn.className = "context-picker-item context-picker-add-item";
    addAccBtn.style.justifyContent = "center";
    addAccBtn.innerHTML = '<i data-lucide="mail-plus"></i><span>Add Account</span>';
    addAccBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      closePicker();
      showEmailSetupModal();
    });
    emailSection.appendChild(addAccBtn);
  } else {
    for (var k = 0; k < emailAccountList.length; k++) {
      var acc = emailAccountList[k];
      var emailSourceId = "email:" + acc.id;
      var emailActive = activeSourceIds.has(emailSourceId);
      var unreadCount = emailUnreadCounts[acc.id] || 0;

      var emailItem = document.createElement("div");
      emailItem.className = "context-picker-item" + (emailActive ? " active" : "");
      emailItem.setAttribute("data-source-id", emailSourceId);

      var unreadBadge = unreadCount > 0
        ? '<span class="context-picker-unread-badge">' + unreadCount + '</span>'
        : '';

      emailItem.innerHTML =
        '<i data-lucide="mail"></i>' +
        '<span>' + escapeHtml(acc.email) + '</span>' +
        unreadBadge +
        '<i data-lucide="check" class="context-picker-check"></i>';

      emailItem.addEventListener("click", function() {
        toggleSource(this.getAttribute("data-source-id"));
        if (typeof lucide !== "undefined") lucide.createIcons();
      });

      emailSection.appendChild(emailItem);
    }

    // "Add Account" link at the bottom
    var addMoreBtn = document.createElement("div");
    addMoreBtn.className = "context-picker-item context-picker-add-item";
    addMoreBtn.innerHTML = '<i data-lucide="plus"></i><span>Add Email Account</span>';
    addMoreBtn.addEventListener("click", function () {
      closePicker();
      showEmailSetupModal();
    });
    emailSection.appendChild(addMoreBtn);
  }

  if (typeof lucide !== "undefined") lucide.createIcons();
}

// --- Email Setup Modal ---

export function getEmailAccountListCache() {
  return emailAccountList;
}

function getSourceLabel(id) {
  if (id.startsWith("term:")) {
    var termId = parseInt(id.split(":")[1], 10);
    for (var i = 0; i < terminalList.length; i++) {
      if (terminalList[i].id === termId) {
        return terminalList[i].title || ("Terminal " + termId);
      }
    }
    return "Terminal " + termId;
  }
  if (id.startsWith("tab:")) {
    var tabId = parseInt(id.split(":")[1], 10);
    for (var j = 0; j < browserTabList.length; j++) {
      if (browserTabList[j].id === tabId) {
        var title = browserTabList[j].title || browserTabList[j].url || "";
        return title.length > 30 ? title.slice(0, 27) + "..." : title;
      }
    }
    return "Tab " + tabId;
  }
  if (id.startsWith("email:")) {
    var accId = id.split(":")[1];
    for (var k = 0; k < emailAccountList.length; k++) {
      if (emailAccountList[k].id === accId) {
        var email = emailAccountList[k].email;
        return email.length > 30 ? email.slice(0, 27) + "..." : email;
      }
    }
    return "Email";
  }
  return id;
}

function getSourceIcon(id) {
  if (id.startsWith("term:")) return "square-terminal";
  if (id.startsWith("tab:")) return "globe";
  if (id.startsWith("email:")) return "mail";
  return "circle";
}

// Get active source IDs (for use when sending messages)
export function getActiveSources() {
  return Array.from(activeSourceIds);
}

// Check if any sources are active
export function hasActiveSources() {
  return activeSourceIds.size > 0;
}

function escapeHtml(str) {
  var div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
