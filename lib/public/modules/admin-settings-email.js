import { store } from './store.js';
import { iconHtml, refreshIcons } from './icons.js';
import { showToast, copyToClipboard, escapeHtml } from './utils.js';
import { apiGet, apiPost, apiPut, apiDelete, showConfirmDialog, showConfirmResetPin, prepareAdminModal } from './admin-settings-ui.js';
import { setSettingsDraft, clearSettingsDraft } from './server-settings-state.js';
// --- SMTP Configuration ---
export function loadSmtpTab(body) {
  apiGet("/api/admin/smtp").then(function (data) {
    if (!(store.get('serverSettingsDrafts') || {}).smtp) renderSmtpTab(body, data.smtp);
  }).catch(function () {
    body.innerHTML = '<div class="admin-error">Failed to load SMTP settings</div>';
  });
}

function renderSmtpTab(body, cfg) {
  var hasConfig = !!(cfg && cfg.host);
  var html = '<div class="admin-smtp-form">';

  var emailEnabled = !!(cfg && cfg.emailLoginEnabled);
  if (hasConfig) {
    html += '<div class="admin-smtp-status admin-smtp-status-ok">' + iconHtml("check-circle") + ' SMTP configured. Invite links and one-time login codes are sent via email.</div>';
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
  body.oninput = function () { setSettingsDraft('smtp', true); };
  body.onchange = function () { setSettingsDraft('smtp', true); };
  refreshIcons(body);

  var errorEl = body.querySelector("#smtp-error");

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
        loadSmtpTab(body);
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
          loadSmtpTab(body);
        }).catch(function (error) { errorEl.textContent = error.message; errorEl.className = "admin-smtp-error admin-smtp-error-visible"; });
      });
    });
  }
}
