import { showToast } from './utils.js';
import { preparePersonalConnectionDialog } from './personal-settings-dialog.js';
// Context Sources — attach terminal output, browser tabs, and email accounts as context for Claude

var ctx = null;
var activeSourceIds = new Set();
var terminalList = []; // synced from terminal module's term_list
var browserTabList = []; // synced from Chrome extension via postMessage
var emailAccountList = []; // synced from server via email_accounts_list
var emailProviders = {}; // provider presets from server
var emailUnreadCounts = {}; // accountId -> unread count
var _emailTestPassed = false;
var _emailPendingSave = false;
var _emailDoSave = null; // set by showEmailSetupModal

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

export function showEmailSetupModal() {
  // Remove any existing modal
  var existing = document.getElementById("email-setup-modal");
  if (existing) {existing.querySelector("input").focus();return;}

  var overlay = document.createElement("div");
  overlay.id = "email-setup-modal";
  overlay.className = "email-setup-overlay";

  var providerOptions = '<option value="gmail">Gmail</option><option value="outlook">Outlook</option><option value="yahoo">Yahoo</option><option value="custom">Custom</option>';

  var modal = document.createElement("div");
  modal.className = "email-setup-dialog";
  modal.innerHTML =
    '<h3 class="email-setup-title">Add Email Account</h3>' +
    '<div class="email-setup-field">' +
      '<label class="email-setup-label">Provider</label>' +
      '<select id="email-setup-provider" class="email-setup-input">' + providerOptions + '</select>' +
    '</div>' +
    '<div class="email-setup-field">' +
      '<label class="email-setup-label">Email Address</label>' +
      '<input id="email-setup-address" type="email" placeholder="you@example.com" class="email-setup-input" />' +
    '</div>' +
    '<div class="email-setup-field">' +
      '<label class="email-setup-label">App Password</label>' +
      '<div class="email-setup-password-wrap">' +
        '<input id="email-setup-password" type="password" placeholder="xxxx-xxxx-xxxx-xxxx" class="email-setup-input" />' +
        '<button id="email-setup-password-toggle" type="button" class="email-setup-password-eye" title="Show password"><i data-lucide="eye"></i></button>' +
      '</div>' +
      '<a id="email-setup-help" href="https://support.google.com/accounts/answer/185833" target="_blank" rel="noopener" class="email-setup-help">How to create an App Password</a>' +
    '</div>' +
    '<div id="email-setup-custom-fields" style="display:none;">' +
      '<div class="email-setup-field">' +
        '<label class="email-setup-label">IMAP Host</label>' +
        '<div class="email-setup-row">' +
          '<input id="email-setup-imap-host" type="text" placeholder="imap.example.com" class="email-setup-input" style="flex:1;" />' +
          '<input id="email-setup-imap-port" type="number" value="993" class="email-setup-input email-setup-port" />' +
        '</div>' +
      '</div>' +
      '<div class="email-setup-field">' +
        '<label class="email-setup-label">SMTP Host</label>' +
        '<div class="email-setup-row">' +
          '<input id="email-setup-smtp-host" type="text" placeholder="smtp.example.com" class="email-setup-input" style="flex:1;" />' +
          '<input id="email-setup-smtp-port" type="number" value="587" class="email-setup-input email-setup-port" />' +
        '</div>' +
      '</div>' +
    '</div>' +
    '<div id="email-setup-status" class="email-setup-status"></div>' +
    '<div class="email-setup-actions">' +
      '<button id="email-setup-test" type="button" class="email-setup-btn email-setup-btn-secondary">Test Connection</button>' +
      '<button id="email-setup-cancel" type="button" class="email-setup-btn email-setup-btn-ghost">Cancel</button>' +
      '<button id="email-setup-save" type="button" class="email-setup-btn email-setup-btn-primary">Add Account</button>' +
    '</div>';

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  preparePersonalConnectionDialog(overlay);

  // Event: close on overlay click
  overlay.addEventListener("click", function (e) {
    if (e.target === overlay) overlay.remove();
  });

  // Event: cancel button
  document.getElementById("email-setup-cancel").addEventListener("click", function () {
    overlay.remove();
  });

  // Event: password visibility toggle
  var pwInput = document.getElementById("email-setup-password");
  var pwToggle = document.getElementById("email-setup-password-toggle");
  pwToggle.addEventListener("click", function () {
    var isHidden = pwInput.type === "password";
    pwInput.type = isHidden ? "text" : "password";
    pwToggle.innerHTML = isHidden ? '<i data-lucide="eye-off"></i>' : '<i data-lucide="eye"></i>';
    pwToggle.title = isHidden ? "Hide password" : "Show password";
    if (typeof lucide !== "undefined") lucide.createIcons();
  });

  // Event: provider change
  var providerSelect = document.getElementById("email-setup-provider");
  var helpLink = document.getElementById("email-setup-help");
  var customFields = document.getElementById("email-setup-custom-fields");

  // Provider presets only configure IMAP/SMTP infra and the help link.
  // The user always enters their full email address (e.g. user@company.com),
  // so Google Workspace / Microsoft 365 accounts on custom domains work too.
  var providerMeta = {
    gmail: {
      helpUrl: "https://support.google.com/accounts/answer/185833",
    },
    outlook: {
      helpUrl: "https://support.microsoft.com/en-us/account-billing/using-app-passwords-with-apps-that-don-t-support-two-step-verification-5896ed9b-4263-e681-128a-a6f2979a7944",
    },
    yahoo: {
      helpUrl: "https://help.yahoo.com/kb/generate-manage-third-party-passwords-sln15241.html",
    },
    custom: {
      helpUrl: null,
    },
  };

  var emailInput = document.getElementById("email-setup-address");

  function applyProviderMeta(val) {
    var meta = providerMeta[val] || providerMeta.custom;
    customFields.style.display = val === "custom" ? "block" : "none";
    if (meta.helpUrl) {
      helpLink.href = meta.helpUrl;
      helpLink.style.display = "";
    } else {
      helpLink.style.display = "none";
    }
  }

  providerSelect.addEventListener("change", function () {
    applyProviderMeta(providerSelect.value);
  });

  // Reset test state
  _emailTestPassed = false;
  _emailPendingSave = false;

  // Reset test status when inputs change
  function onInputChange() {
    _emailTestPassed = false;
    _emailPendingSave = false;
    var saveBtn = document.getElementById("email-setup-save");
    if (saveBtn) saveBtn.textContent = "Add Account";
  }
  document.getElementById("email-setup-address").addEventListener("input", onInputChange);
  document.getElementById("email-setup-password").addEventListener("input", onInputChange);
  providerSelect.addEventListener("change", onInputChange);

  function runTest() {
    var statusEl = document.getElementById("email-setup-status");
    var emailAddr = getFullEmail();
    var appPass = document.getElementById("email-setup-password").value;

    if (!emailAddr || emailAddr.indexOf("@") === -1 || !appPass) {
      statusEl.style.display = "block";
      statusEl.style.color = "var(--error, #e74c3c)";
      statusEl.textContent = "Email and app password are required.";
      return;
    }

    statusEl.style.display = "block";
    statusEl.style.color = "var(--text-muted)";
    statusEl.textContent = "Testing connection...";

    var msgData = buildEmailSetupData();
    msgData.type = "email_account_test";

    if (ctx && ctx.ws && ctx.connected) {
      ctx.ws.send(JSON.stringify(msgData));
    }
  }

  // Event: test connection
  document.getElementById("email-setup-test").addEventListener("click", function () {
    _emailPendingSave = false;
    runTest();
  });

  // Event: save (requires test to pass first)
  document.getElementById("email-setup-save").addEventListener("click", function () {
    if (_emailTestPassed) {
      // Test already passed, proceed with save
      doSave();
      return;
    }
    // Run test first, then auto-save on success
    _emailPendingSave = true;
    var saveBtn = document.getElementById("email-setup-save");
    if (saveBtn) saveBtn.textContent = "Testing...";
    runTest();
  });

  _emailDoSave = doSave;
  function doSave() {
    var statusEl = document.getElementById("email-setup-status");
    statusEl.style.display = "block";
    statusEl.style.color = "var(--text-muted)";
    statusEl.textContent = "Adding account...";

    var msgData = buildEmailSetupData();
    msgData.type = "email_account_add";

    if (ctx && ctx.ws && ctx.connected) {
      ctx.ws.send(JSON.stringify(msgData));
    }
  }
}

function getFullEmail() {
  return document.getElementById("email-setup-address").value.trim();
}

function buildEmailSetupData() {
  var provider = document.getElementById("email-setup-provider").value;
  var email = getFullEmail();
  var appPassword = document.getElementById("email-setup-password").value;
  var data = { provider: provider, email: email, appPassword: appPassword };

  if (provider === "custom") {
    data.imap = {
      host: document.getElementById("email-setup-imap-host").value.trim(),
      port: parseInt(document.getElementById("email-setup-imap-port").value, 10) || 993,
      tls: true,
    };
    data.smtp = {
      host: document.getElementById("email-setup-smtp-host").value.trim(),
      port: parseInt(document.getElementById("email-setup-smtp-port").value, 10) || 587,
    };
  }
  return data;
}

// Handle email_account_test_result from server
export function handleEmailTestResult(msg) {
  var statusEl = document.getElementById("email-setup-status");
  if (!statusEl) return;
  var saveBtn = document.getElementById("email-setup-save");

  statusEl.style.display = "block";
  if (msg.ok) {
    _emailTestPassed = true;
    if (_emailPendingSave && _emailDoSave) {
      // Test passed from Add Account click, proceed to save
      _emailPendingSave = false;
      _emailDoSave();
      return;
    }
    statusEl.style.color = "var(--success, #2ecc71)";
    statusEl.textContent = "Connection successful! IMAP and SMTP both working.";
  } else {
    _emailTestPassed = false;
    _emailPendingSave = false;
    if (saveBtn) saveBtn.textContent = "Add Account";
    statusEl.style.color = "var(--error, #e74c3c)";
    var parts = [];
    if (msg.imap && !msg.imap.ok) parts.push("IMAP: " + (msg.imap.error || "failed"));
    if (msg.smtp && !msg.smtp.ok) parts.push("SMTP: " + (msg.smtp.error || "failed"));
    statusEl.textContent = parts.length > 0 ? parts.join("; ") : (msg.error || "Connection failed");
  }
}

// Handle email_account_add_result from server
export function handleEmailAddResult(msg) {
  var statusEl = document.getElementById("email-setup-status");
  if (!statusEl) return;

  statusEl.style.display = "block";
  if (msg.ok) {
    statusEl.style.color = "#2ecc71";
    statusEl.textContent = "Account added successfully!";
    // Close modal after short delay
    setTimeout(function () {
      var modal = document.getElementById("email-setup-modal");
      if (modal) modal.remove();
    }, 800);
  } else {
    statusEl.style.color = "#e74c3c";
    statusEl.textContent = msg.error || "Failed to add account.";
  }
}

// Handle email_account_remove_result from server
export function handleEmailRemoveResult(msg) {
  showToast(msg.ok ? 'Personal mailbox disconnected.' : msg.error || 'Could not disconnect mailbox. Retry from Email settings.');
  // The acknowledged list arrives separately through email_accounts_list.
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
