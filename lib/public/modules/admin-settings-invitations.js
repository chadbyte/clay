import { store } from './store.js';
import { iconHtml, refreshIcons } from './icons.js';
import { showToast, copyToClipboard, escapeHtml } from './utils.js';
import { apiGet, apiPost, apiPut, apiDelete, showConfirmDialog, showConfirmResetPin, prepareAdminModal } from './admin-settings-ui.js';
// --- Invites ---
export function loadInvitesTab(body) {
  apiGet("/api/admin/invites").then(function (data) {
    store.set({ adminInvites: (data.invites || []).filter(function (inv) { return !inv.used && inv.expiresAt > Date.now(); }) });
    renderInvitesTab(body);
  }).catch(function () {
    body.innerHTML = '<div class="admin-error">Failed to load invites</div>';
  });
}

function renderInvitesTab(body) {
  var smtpEnabled = store.get('adminMe') && store.get('adminMe').smtpEnabled;
  var html = '<div class="admin-section-header">' +
    '<div class="admin-header-btns">';
  if (smtpEnabled) {
    html += '<button class="admin-action-btn" id="admin-email-invite">' + iconHtml("mail") + ' Email Invite</button>';
  }
  html += '<button class="admin-action-btn admin-action-btn-secondary" id="admin-create-invite">' + iconHtml("plus") + ' Generate Link</button>' +
    '</div></div>';

  if (store.get('adminInvites').length === 0) {
    html += '<div class="admin-empty">No active invites. Generate one to add a new user.</div>';
  } else {
    html += '<div class="admin-invite-list">';
    for (var i = 0; i < store.get('adminInvites').length; i++) {
      var inv = store.get('adminInvites')[i];
      var expiresIn = Math.max(0, Math.ceil((inv.expiresAt - Date.now()) / (60 * 60 * 1000)));
      html += '<div class="admin-invite-item">';
      html += '<div class="admin-invite-info">';
      html += '<code class="admin-invite-code">' + escapeHtml(inv.code.substring(0, 8)) + '...</code>';
      if (inv.email) html += '<span class="admin-invite-email">' + escapeHtml(inv.email) + '</span>';
      html += '<span class="admin-invite-expiry">expires in ' + expiresIn + 'h</span>';
      html += '</div>';
      html += '<div class="admin-invite-actions">';
      html += '<button class="admin-copy-link-btn" data-code="' + escapeHtml(inv.code) + '" title="Copy link">' + iconHtml("copy") + '</button>';
      html += '<button class="admin-revoke-btn" data-code="' + escapeHtml(inv.code) + '" title="Revoke">' + iconHtml("x") + '</button>';
      html += '</div>';
      html += '</div>';
    }
    html += '</div>';
  }

  body.innerHTML = html;
  refreshIcons(body);

  // Generate invite link
  var createBtn = body.querySelector("#admin-create-invite");
  if (createBtn) {
    createBtn.addEventListener("click", function () {
      createInvite(body);
    });
  }

  // Email invite
  var emailBtn = body.querySelector("#admin-email-invite");
  if (emailBtn) {
    emailBtn.addEventListener("click", function () {
      showEmailInvitePrompt(body);
    });
  }

  // Copy link buttons
  var copyBtns = body.querySelectorAll(".admin-copy-link-btn");
  for (var j = 0; j < copyBtns.length; j++) {
    copyBtns[j].addEventListener("click", function () {
      var code = this.dataset.code;
      var url = location.origin + "/invite/" + code;
      copyToClipboard(url).then(function () {
        showToast("Invite link copied");
      });
    });
  }

  // Revoke buttons
  var revokeBtns = body.querySelectorAll(".admin-revoke-btn");
  for (var k = 0; k < revokeBtns.length; k++) {
    revokeBtns[k].addEventListener("click", function () {
      var code = this.dataset.code;
      var btn = this;
      showConfirmDialog("Revoke this invite? The link will no longer work.", "Revoke", function () {
        btn.disabled = true;
        fetch("/api/admin/invites/" + encodeURIComponent(code), { method: "DELETE" })
          .then(function (r) { return r.json(); })
          .then(function (d) {
            if (d.ok) {
              showToast("Invite revoked");
              loadInvitesTab(body);
            } else {
              showToast(d.error || "Failed to revoke");
              btn.disabled = false;
            }
          })
          .catch(function () {
            showToast("Failed to revoke invite");
            btn.disabled = false;
          });
      });
    });
  }
}

function createInvite(body) {
  apiPost("/api/admin/invites").then(function (data) {
    if (data.ok && data.url) {
      copyToClipboard(data.url).then(function () {
        showToast("Invite link created and copied!");
      }).catch(function () {
        showToast("Invite created: " + data.url);
      });
      loadInvitesTab(body);
    } else {
      showToast(data.error || "Failed to create invite");
    }
  }).catch(function () {
    showToast("Failed to create invite");
  });
}

function showEmailInvitePrompt(body) {
  var modal = document.createElement("div");
  modal.className = "admin-modal-overlay";
  var html = '<div class="admin-modal">' +
    '<div class="admin-modal-header">' +
    '<h3>Send Email Invite</h3>' +
    '<button class="admin-modal-close">' + iconHtml("x") + '</button>' +
    '</div>' +
    '<div class="admin-modal-body">' +
    '<p class="admin-modal-desc">Enter the email address to send an invitation to:</p>' +
    '<input type="email" class="admin-smtp-input" id="admin-invite-email" placeholder="user@example.com" autocomplete="off">' +
    '<div class="admin-smtp-error" id="admin-invite-error"></div>' +
    '</div>' +
    '<div class="admin-modal-footer">' +
    '<button class="admin-modal-save" id="admin-invite-send">Send Invite</button>' +
    '<button class="admin-modal-cancel">Cancel</button>' +
    '</div></div>';
  modal.innerHTML = html;
  document.body.appendChild(modal);
  prepareAdminModal(modal);
  refreshIcons(modal);

  var emailInput = modal.querySelector("#admin-invite-email");
  var sendBtn = modal.querySelector("#admin-invite-send");
  var errorEl = modal.querySelector("#admin-invite-error");

  modal.querySelector(".admin-modal-close").addEventListener("click", function () { modal.remove(); });
  modal.querySelector(".admin-modal-cancel").addEventListener("click", function () { modal.remove(); });
  modal.addEventListener("click", function (e) { if (e.target === modal) modal.remove(); });

  emailInput.focus();
  emailInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") sendBtn.click();
  });

  sendBtn.addEventListener("click", function () {
    var email = emailInput.value.trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errorEl.textContent = "Enter a valid email address";
      return;
    }
    sendBtn.disabled = true;
    sendBtn.textContent = "Sending...";
    errorEl.textContent = "";
    apiPost("/api/admin/invites/email", { email: email }).then(function (data) {
      if (data.ok) {
        showToast("Invite sent to " + email);
        modal.remove();
        loadInvitesTab(body);
      } else {
        errorEl.textContent = data.error || "Failed to send invite";
        sendBtn.disabled = false;
        sendBtn.textContent = "Send Invite";
      }
    }).catch(function () {
      errorEl.textContent = "Failed to send invite";
      sendBtn.disabled = false;
      sendBtn.textContent = "Send Invite";
    });
  });
}
