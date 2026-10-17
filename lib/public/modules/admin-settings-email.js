import { store } from './store.js';
import { iconHtml, refreshIcons } from './icons.js';
import { showToast, copyToClipboard, escapeHtml } from './utils.js';
import { apiGet, apiPost, apiPut, apiDelete, showConfirmDialog, showConfirmResetPin, prepareAdminModal } from './admin-settings-ui.js';
import { setSettingsDraft, clearSettingsDraft } from './server-settings-state.js';
// --- SMTP Configuration ---
export function loadSmtpTab(body) {
  apiGet("/api/admin/smtp").then(function (data) {
    if (!(store.get('serverSettingsDrafts') || {}).smtp) renderSmtpOverview(body, data.smtp);
  }).catch(function () {
    body.innerHTML = '<div class="admin-error">Failed to load SMTP settings</div>';
  });
}

function renderSmtpOverview(body, cfg, focus) {
  var configured = !!(cfg && cfg.host);
  clearSettingsDraft('smtp');
  body.oninput = null;
  body.onchange = null;
  var html = '<div class="settings-section-heading"><h3>Configuration</h3><button type="button" class="settings-btn-sm" id="smtp-edit">Edit</button></div>';
  html += '<p class="settings-hint">' + (configured ? 'SMTP configured. New email deliveries use the saved configuration.' : 'SMTP is not configured. Users sign in with a PIN. Choose Edit to set up email delivery.') + '</p>';
  if (configured) {
    var fields = [
      ['SMTP host', cfg.host], ['Port', String(cfg.port || 587)],
      ['Connection', cfg.secure ? 'Direct TLS/SSL' : 'STARTTLS'],
      ['Username', cfg.user || '—'], ['Password', cfg.pass ? 'Configured · hidden' : 'Not configured'],
      ['From address', cfg.from || '—'], ['Email login', cfg.emailLoginEnabled ? 'Enabled' : 'Disabled']
    ];
    html += '<dl class="settings-summary">';
    fields.forEach(function (field) {
      html += '<div class="settings-field-row"><dt class="settings-label">' + escapeHtml(field[0]) + '</dt><dd class="settings-value">' + escapeHtml(field[1]) + '</dd></div>';
    });
    html += '</dl><p class="settings-hint">Configuration is saved; delivery is not verified here. Edit to change settings or send a test email.</p>';
  }
  body.innerHTML = html;
  var edit = body.querySelector('#smtp-edit');
  edit.onclick = function () { renderSmtpTab(body, cfg); body.querySelector('#smtp-host').focus(); };
  if (focus) edit.focus();
}

function renderSmtpTab(body, cfg) {
  var hasConfig = !!(cfg && cfg.host);
  var html = '<div class="admin-smtp-form">';

  var emailEnabled = !!(cfg && cfg.emailLoginEnabled);
  if (hasConfig) {
    html += '<div class="admin-smtp-status admin-smtp-status-ok">' + iconHtml("check-circle") + ' SMTP configured. New email deliveries use the saved configuration.</div>';
  } else {
    html += '<div class="admin-smtp-status admin-smtp-status-off">' + iconHtml("mail-x") + ' SMTP not configured. Users log in with a PIN instead of email codes.</div>';
  }

  html += '<div class="admin-smtp-fields">';
  html += '<div class="admin-smtp-row">' +
    '<label for="smtp-host">SMTP host</label>' +
    '<input type="text" id="smtp-host" class="admin-smtp-input" placeholder="smtp.gmail.com" value="' + escapeHtml((cfg && cfg.host) || "") + '">' +
    '</div>';
  html += '<div class="admin-smtp-row-half">' +
    '<div class="admin-smtp-row">' +
    '<label for="smtp-port">Port</label>' +
    '<input type="number" id="smtp-port" class="admin-smtp-input" placeholder="587" value="' + ((cfg && cfg.port) || 587) + '">' +
    '</div>' +
    '<div class="admin-smtp-row">' +
    '<label for="smtp-secure">Secure (TLS)</label>' +
    '<label class="admin-smtp-toggle"><input type="checkbox" id="smtp-secure"' + (cfg && cfg.secure ? " checked" : "") + '><span>Use TLS/SSL</span></label>' +
    '</div></div>';
  html += '<div class="admin-smtp-row">' +
    '<label for="smtp-user">Username</label>' +
    '<input type="text" id="smtp-user" class="admin-smtp-input" placeholder="you@gmail.com" value="' + escapeHtml((cfg && cfg.user) || "") + '" autocomplete="off">' +
    '</div>';
  html += '<div class="admin-smtp-row">' +
    '<label for="smtp-pass">Password</label>' +
    '<input type="password" id="smtp-pass" class="admin-smtp-input" placeholder="App password" value="' + escapeHtml((cfg && cfg.pass) || "") + '" autocomplete="off">' +
    '</div>';
  html += '<div class="admin-smtp-row">' +
    '<label for="smtp-from">From address</label>' +
    '<input type="text" id="smtp-from" class="admin-smtp-input" placeholder="Clay <noreply@example.com>" value="' + escapeHtml((cfg && cfg.from) || "") + '">' +
    '</div>';
  html += '<div class="admin-smtp-row admin-smtp-row-otp">' +
    '<label for="smtp-email-login">Email login (OTP)</label>' +
    '<label class="admin-smtp-toggle"><input type="checkbox" id="smtp-email-login"' + (emailEnabled ? " checked" : "") + (hasConfig ? "" : " disabled") + '>' +
    '<span>' + (hasConfig ? "Require email for user registration and enable OTP login" : "Configure SMTP first to enable") + '</span></label>' +
    '</div>';
  html += '</div>';

  html += '<div class="admin-smtp-actions">';
  html += '<button type="button" class="admin-action-btn admin-action-btn-secondary" id="smtp-cancel">Cancel</button>';
  html += '<button class="admin-action-btn" id="smtp-save">' + iconHtml("save") + ' Save</button>';
  html += '<button class="admin-action-btn admin-action-btn-secondary" id="smtp-test">' + iconHtml("send") + ' Send test email</button>';
  if (hasConfig) {
    html += '<button class="admin-action-btn admin-action-btn-danger" id="smtp-remove">' + iconHtml("trash-2") + ' Remove</button>';
  }
  html += '</div>';
  html += '<div class="admin-smtp-error" id="smtp-error"></div>';
  html += '<div class="admin-smtp-hint">For Gmail, use an <a href="https://support.google.com/accounts/answer/185833" target="_blank" rel="noopener">App Password</a>. Port 587 with TLS off uses STARTTLS. Port 465 with TLS on uses direct SSL.</div>';
  html += '</div>';

  body.innerHTML = html;
  clearSettingsDraft('smtp');
  // The draft is the form differing from what was rendered, so reverting a field clears it.
  var fields = Array.from(body.querySelectorAll('input, select, textarea'));
  function fieldValue(field) { return field.type === 'checkbox' ? field.checked : field.value; }
  var baseline = fields.map(fieldValue);
  function syncDraft() { setSettingsDraft('smtp', fields.some(function (field, index) { return fieldValue(field) !== baseline[index]; })); }
  body.oninput = syncDraft;
  body.onchange = syncDraft;
  refreshIcons(body);

  var errorEl = body.querySelector("#smtp-error");
  body.querySelector('#smtp-cancel').onclick = function () {
    if (body.querySelector('#smtp-save').disabled) return;
    function cancel() { renderSmtpOverview(body, cfg, true); }
    if ((store.get('serverSettingsDrafts') || {}).smtp) showConfirmDialog('Discard your unsaved email delivery changes?', 'Discard changes', cancel);
    else cancel();
  };

  function getFormData() {
    return {
      host: body.querySelector("#smtp-host").value.trim(),
      port: parseInt(body.querySelector("#smtp-port").value, 10) || 587,
      secure: body.querySelector("#smtp-secure").checked,
      user: body.querySelector("#smtp-user").value.trim(),
      pass: body.querySelector("#smtp-pass").value,
      from: body.querySelector("#smtp-from").value.trim(),
      emailLoginEnabled: body.querySelector("#smtp-email-login").checked,
    };
  }

  // Save
  body.querySelector("#smtp-save").addEventListener("click", function () {
    var formData = getFormData();
    if (!formData.host || !formData.user || !formData.pass || !formData.from) {
      errorEl.textContent = "All fields are required";
      errorEl.className = "admin-smtp-error admin-smtp-error-visible";
      return;
    }
    var btn = this;
    btn.disabled = true;
    body.querySelectorAll("input").forEach(function (input) { input.disabled = true; });
    errorEl.textContent = "";
    errorEl.className = "admin-smtp-error";
    apiPost("/api/admin/smtp", formData).then(function (data) {
      if (data.ok) {
        clearSettingsDraft("smtp");
        showToast("SMTP settings saved. New email deliveries use this configuration.");
        renderSmtpOverview(body, Object.assign({}, formData, { pass: '••••••••' }), true);
      } else {
        errorEl.textContent = data.error || "Failed to save";
        errorEl.className = "admin-smtp-error admin-smtp-error-visible";
        btn.disabled = false;
        body.querySelectorAll("input").forEach(function (input) { input.disabled = input.id === "smtp-email-login" && !hasConfig; });
      }
    }).catch(function () {
      errorEl.textContent = "Failed to save settings";
      errorEl.className = "admin-smtp-error admin-smtp-error-visible";
      btn.disabled = false;
      body.querySelectorAll("input").forEach(function (input) { input.disabled = input.id === "smtp-email-login" && !hasConfig; });
    });
  });

  // Test
  body.querySelector("#smtp-test").addEventListener("click", function () {
    var formData = getFormData();
    if (!formData.host || !formData.user || !formData.pass || !formData.from) {
      errorEl.textContent = "Fill in all fields first";
      errorEl.className = "admin-smtp-error admin-smtp-error-visible";
      return;
    }
    var btn = this;
    btn.disabled = true;
    errorEl.textContent = "";
    errorEl.className = "admin-smtp-error";
    apiPost("/api/admin/smtp/test", formData).then(function (data) {
      if (data.ok) {
        showToast(data.message || "Test email sent!");
        errorEl.textContent = "";
        errorEl.className = "admin-smtp-error";
      } else {
        errorEl.textContent = data.error || "Test failed";
        errorEl.className = "admin-smtp-error admin-smtp-error-visible";
      }
      btn.disabled = false;
    }).catch(function () {
      errorEl.textContent = "Connection failed";
      errorEl.className = "admin-smtp-error admin-smtp-error-visible";
      btn.disabled = false;
    });
  });

  // Remove
  var removeBtn = body.querySelector("#smtp-remove");
  if (removeBtn) {
    removeBtn.addEventListener("click", function () {
      showConfirmDialog("Remove SMTP configuration? Users will need to use PIN login.", "Remove SMTP", function () {
        apiPost("/api/admin/smtp", { host: "", user: "", pass: "", from: "" }).then(function (data) {
          if (!data.ok) throw new Error(data.error || "Could not remove SMTP configuration");
          showToast("SMTP configuration removed");
          renderSmtpOverview(body, null, true);
        }).catch(function (error) { errorEl.textContent = error.message; errorEl.className = "admin-smtp-error admin-smtp-error-visible"; });
      });
    });
  }
}
