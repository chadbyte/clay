import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { showToast } from './utils.js';
import { preparePersonalConnectionDialog, closePersonalEmailEditor } from './personal-settings-dialog.js';
import { selectIntegrationEditor } from './personal-integration-editor.js';

function settleEmailRequest() {
  store.set({personalEmailSaving:false});
  document.querySelectorAll('#email-setup-modal input, #email-setup-modal button').forEach(function (el) { el.disabled = false; });
}

export function showEmailSetupModal(provider, host) {
  if (host) {
    selectIntegrationEditor('email-add:' + provider, '#email-setup-modal', function () { openEmailSetup(provider, host); });
    return;
  }
  openEmailSetup(provider, host);
}
function openEmailSetup(provider, host) {
  var providerNames = { gmail: "Gmail", outlook: "Outlook Mail", yahoo: "Yahoo Mail", custom: "Custom email" };
  if (!Object.hasOwn(providerNames, provider)) provider = null;
  // Remove any existing modal
  var existing = document.getElementById("email-setup-modal");
  if (existing) {existing.querySelector("input:not([type=hidden]),button").focus();return;}

  var overlay = document.createElement("div");
  overlay.id = "email-setup-modal";
  overlay.className = host ? "email-setup-inline" : "email-setup-overlay";

  if (!provider) {
    var picker = document.createElement('div'); picker.className = 'email-setup-dialog';
    picker.innerHTML = '<h3>Choose an email provider</h3><div class="us-integration-tiles"></div><button id="email-setup-cancel" type="button" class="email-setup-btn">Cancel</button>';
    Object.keys(providerNames).forEach(function (id) {
      var button = document.createElement('button'); button.type = 'button'; button.className = 'email-setup-btn'; button.textContent = providerNames[id];
      button.onclick = function () { closePicker(); showEmailSetupModal(id, host); };
      picker.querySelector('.us-integration-tiles').appendChild(button);
    });
    overlay.appendChild(picker); (host || document.body).appendChild(overlay); var closePicker = preparePersonalConnectionDialog(overlay, !!host); return;
  }
  var modal = document.createElement("div");
  modal.className = "email-setup-dialog";
  modal.innerHTML =
    '<h3 class="email-setup-title">Add ' + providerNames[provider] + ' account</h3>' +
    '<input type="hidden" id="email-setup-provider" value="' + provider + '">' +
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
  (host || document.body).appendChild(overlay);
  preparePersonalConnectionDialog(overlay, !!host);

  // Event: close on overlay click
  overlay.addEventListener("click", function (e) {
    if (!host && e.target === overlay) overlay.remove();
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

  applyProviderMeta(provider);

  // Reset test state
  store.set({personalEmailTestPassed:false});
  store.set({personalEmailPendingSave:false});

  // Reset test status when inputs change
  function onInputChange() {
    store.set({personalEmailTestPassed:false});
    store.set({personalEmailPendingSave:false});
    var saveBtn = document.getElementById("email-setup-save");
    if (saveBtn) saveBtn.textContent = "Add Account";
  }
  overlay.addEventListener('input', onInputChange);


  function runTest() {
    var statusEl = document.getElementById("email-setup-status");
    var emailAddr = getFullEmail();
    var appPass = document.getElementById("email-setup-password").value;

    if (!emailAddr || emailAddr.indexOf("@") === -1 || !appPass) {
      statusEl.style.display = "block";
      statusEl.style.color = "var(--error, #e74c3c)";
      statusEl.textContent = "Email and app password are required.";
      store.set({personalEmailPendingSave:false});
      return;
    }

    statusEl.style.display = "block";
    statusEl.style.color = "var(--text-muted)";
    statusEl.textContent = "Testing connection...";

    var msgData = buildEmailSetupData();
    msgData.type = "email_account_test";

    var ws = getWs();
    if (ws && ws.readyState === 1) {
      store.set({personalEmailSaving:true,personalEmailRequestOwner:store.get('myUserId'),personalEmailRequestSocket:store.get('projectSplitViewSocketGeneration')});
      document.querySelectorAll('#email-setup-modal input, #email-setup-modal button').forEach(function (el) { el.disabled = true; });
      ws.send(JSON.stringify(msgData));
    } else {
      store.set({personalEmailPendingSave:false});
      statusEl.textContent = 'Disconnected. Reconnect and retry.';
    }
  }

  // Event: test connection
  document.getElementById("email-setup-test").addEventListener("click", function () {
    store.set({personalEmailPendingSave:false});
    runTest();
  });

  // Event: save (requires test to pass first)
  document.getElementById("email-setup-save").addEventListener("click", function () {
    if (store.get('personalEmailTestPassed')) {
      // Test already passed, proceed with save
      doSave();
      return;
    }
    // Run test first, then auto-save on success
    store.set({personalEmailPendingSave:true});
    var saveBtn = document.getElementById("email-setup-save");
    if (saveBtn) saveBtn.textContent = "Testing...";
    runTest();
  });

}

function doSave() {
    var statusEl = document.getElementById("email-setup-status");
    statusEl.style.display = "block";
    statusEl.style.color = "var(--text-muted)";
    statusEl.textContent = "Adding account...";

    var msgData = buildEmailSetupData();
    msgData.type = "email_account_add";

    var ws = getWs();
    if (ws && ws.readyState === 1) {
      store.set({personalEmailSaving:true,personalEmailRequestOwner:store.get('myUserId'),personalEmailRequestSocket:store.get('projectSplitViewSocketGeneration')});
      document.querySelectorAll('#email-setup-modal input, #email-setup-modal button').forEach(function (el) { el.disabled = true; });
      ws.send(JSON.stringify(msgData));
    } else {
      store.set({personalEmailPendingSave:false});
      statusEl.textContent = 'Disconnected. Reconnect and retry.';
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
  if (!statusEl || !store.get('personalEmailSaving') || store.get('personalEmailRequestOwner') !== store.get('myUserId') || store.get('personalEmailRequestSocket') !== store.get('projectSplitViewSocketGeneration')) return;
  var saveBtn = document.getElementById("email-setup-save");
  settleEmailRequest();

  statusEl.style.display = "block";
  if (msg.ok) {
    store.set({personalEmailTestPassed:true});
    if (store.get('personalEmailPendingSave')) {
      // Test passed from Add Account click, proceed to save
      store.set({personalEmailPendingSave:false});
      doSave();
      return;
    }
    statusEl.style.color = "var(--success, #2ecc71)";
    statusEl.textContent = "Connection successful! IMAP and SMTP both working.";
  } else {
    store.set({personalEmailTestPassed:false});
    store.set({personalEmailPendingSave:false});
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
  if (!statusEl || !store.get('personalEmailSaving') || store.get('personalEmailRequestOwner') !== store.get('myUserId') || store.get('personalEmailRequestSocket') !== store.get('projectSplitViewSocketGeneration')) return;
  settleEmailRequest();

  statusEl.style.display = "block";
  if (msg.ok) {
    statusEl.style.color = "#2ecc71";
    statusEl.textContent = "Account added successfully!";
    closePersonalEmailEditor();
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
