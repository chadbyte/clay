import { store } from './store.js';
import { iconHtml, refreshIcons } from './icons.js';
import { showToast, copyToClipboard, escapeHtml } from './utils.js';
import { apiGet, apiPost, apiPut, apiDelete, showConfirmDialog, showConfirmResetPin, prepareAdminModal, mountAdminSubview } from './admin-settings-ui.js';
// --- Projects ---
export function loadProjectsTab(body) {
  var projectList = store.get('projectsHubList') || [];
  // Exclude worktree and mate projects (mates are always private to their owner)
  projectList = projectList.filter(function (p) { return !p.isWorktree && !p.isMate; });


  if (projectList.length === 0) {
    body.innerHTML = '<div class="admin-empty">No projects registered.</div>';
    return;
  }

  var accessPromises = projectList.map(function (p) {
    return apiGet("/api/admin/projects/" + p.slug + "/access").then(function (access) {
      return { slug: p.slug, title: p.title || p.project || p.slug, projectOwnerId: p.projectOwnerId || null, visibility: access.visibility || "public", allowedUsers: access.allowedUsers || [], readOnly: access.contentAccess === false || p.projectOwnerId !== store.get("myUserId") };
    });
  });

  Promise.all([
    Promise.all(accessPromises),
    apiGet("/api/admin/users"),
  ]).then(function (results) {
    renderProjectsTab(body, results[0], results[1].users || []);
  }).catch(function (error) { body.textContent = error.message || "Project access unavailable. Reopen Settings to retry."; });
}

function renderProjectsTab(body, projectAccessList, allUsers) {
  var html = '<div class="admin-project-list">';
  for (var i = 0; i < projectAccessList.length; i++) {
    var p = projectAccessList[i];
    var visClass = p.visibility === "private" ? "admin-vis-private" : "admin-vis-public";
    html += '<div class="admin-project-item" data-slug="' + escapeHtml(p.slug) + '">';
    html += '<div class="admin-project-info">';
    html += '<div class="admin-project-name">' + escapeHtml(p.title) + '</div>';
    html += '<div class="admin-project-slug">' + escapeHtml(p.slug) + '</div>';
    html += '</div>';
    html += '<div class="admin-project-controls">';
    if (p.readOnly) {
      html += '<span class="admin-project-access-readonly">Administrative metadata only</span></div></div>';
      continue;
    }
    // Owner select
    html += '<select aria-label="Project owner" class="admin-owner-select" data-slug="' + escapeHtml(p.slug) + '">';
    if (!p.projectOwnerId) html += '<option value="" selected disabled>Ownership needs recovery</option>';
    for (var u = 0; u < allUsers.length; u++) {
      var user = allUsers[u];
      var sel = p.projectOwnerId === user.id ? ' selected' : '';
      var label = escapeHtml(user.displayName || user.username);
      if (user.linuxUser) label += ' (' + escapeHtml(user.linuxUser) + ')';
      html += '<option value="' + escapeHtml(user.id) + '"' + sel + '>' + label + '</option>';
    }
    html += '</select>';
    // Visibility select
    html += '<select aria-label="Project visibility" class="admin-vis-select ' + visClass + '" data-slug="' + escapeHtml(p.slug) + '">';
    html += '<option value="public"' + (p.visibility === "public" ? " selected" : "") + '>Public</option>';
    html += '<option value="private"' + (p.visibility === "private" ? " selected" : "") + '>Private</option>';
    html += '</select>';
    if (p.visibility === "private") {
      html += '<button aria-label="Manage allowed users" class="admin-manage-users-btn" data-slug="' + escapeHtml(p.slug) + '">' + iconHtml("users") + '</button>';
    }
    html += '</div>';
    html += '</div>';
  }
  html += '</div>';

  body.innerHTML = html;
  refreshIcons(body);

  // Bind owner selects
  var ownerSelects = body.querySelectorAll(".admin-owner-select");
  for (var oi = 0; oi < ownerSelects.length; oi++) {
    ownerSelects[oi].dataset.savedValue = ownerSelects[oi].value;
    ownerSelects[oi].addEventListener("change", function () {
      var slug = this.dataset.slug;
      var userId = this.value;
      this.value = this.dataset.savedValue; this.dispatchEvent(new Event("settings-sync"));
      showConfirmDialog("Transfer project ownership? New processes will use the selected owner’s identity where OS-user mode is enabled.", "Transfer ownership", function () { setProjectOwner(slug, userId, body); });
    });
  }

  // Bind visibility selects
  var visSelects = body.querySelectorAll(".admin-vis-select");
  for (var j = 0; j < visSelects.length; j++) {
    visSelects[j].dataset.savedValue = visSelects[j].value;
    visSelects[j].addEventListener("change", function () {
      var slug = this.dataset.slug;
      var visibility = this.value;
      this.value = this.dataset.savedValue; this.dispatchEvent(new Event("settings-sync"));
      showConfirmDialog("Change project visibility to " + visibility + "? This changes who can access this project.", "Change visibility", function () { setProjectVisibility(slug, visibility, body); });
    });
  }

  // Bind manage users buttons
  var manageUserBtns = body.querySelectorAll(".admin-manage-users-btn");
  for (var k = 0; k < manageUserBtns.length; k++) {
    manageUserBtns[k].addEventListener("click", function () {
      var slug = this.dataset.slug;
      showProjectUsersModal(slug, body);
    });
  }
}

function setProjectOwner(slug, userId, body) {
  apiPut("/api/admin/projects/" + slug + "/owner", { userId: userId || null }).then(function (data) {
    if (data.ok) {
      showToast("Project owner updated");
      loadProjectsTab(body);
    } else {
      showToast(data.error || "Failed to update owner", "error");
    }
  }).catch(function () {
    showToast("Failed to update owner", "error");
  });
}

function setProjectVisibility(slug, visibility, body) {
  apiPut("/api/admin/projects/" + slug + "/visibility", { visibility: visibility }).then(function (data) {
    if (data.ok) {
      showToast("Visibility updated");
      loadProjectsTab(body);
    } else {
      showToast(data.error || "Failed to update visibility");
    }
  }).catch(function () {
    showToast("Failed to update visibility");
  });
}

function showProjectUsersModal(slug, parentBody) {
  Promise.all([
    apiGet("/api/admin/users"),
    apiGet("/api/admin/projects/" + slug + "/access"),
  ]).then(function (results) {
    var allUsers = results[0].users || [];
    var access = results[1];
    var allowed = access.allowedUsers || [];

    var modal = document.createElement("div");
    modal.className = "admin-modal-overlay";

    var html = '<div class="admin-modal">';
    html += '<div class="admin-modal-header">';
    html += '<h3>Manage Access: ' + escapeHtml(slug) + '</h3>';
    html += '<button class="admin-modal-close">' + iconHtml("x") + '</button>';
    html += '</div>';
    html += '<div class="admin-modal-body">';
    html += '<p class="admin-modal-desc">Select users who can access this private project:</p>';

    for (var i = 0; i < allUsers.length; i++) {
      var u = allUsers[i];
      if (u.role === "admin") continue;
      var checked = allowed.indexOf(u.id) >= 0 ? " checked" : "";
      html += '<label class="admin-user-check">';
      html += '<input type="checkbox" value="' + u.id + '"' + checked + '>';
      html += '<span>' + escapeHtml(u.displayName || u.username) + ' <small>' + escapeHtml(u.username) + '</small></span>';
      html += '</label>';
    }

    html += '</div>';
    html += '<div class="admin-modal-footer">';
    html += '<button class="admin-modal-save">Save</button>';
    html += '<button class="admin-modal-cancel">Cancel</button>';
    html += '</div>';
    html += '</div>';

    modal.innerHTML = html;
    mountAdminSubview(modal);
  prepareAdminModal(modal);
    refreshIcons(modal);

    modal.querySelector(".admin-modal-close").addEventListener("click", function () { modal.remove(); });
    modal.querySelector(".admin-modal-cancel").addEventListener("click", function () { modal.remove(); });
    modal.addEventListener("click", function (e) {
      if (e.target === modal) modal.remove();
    });

    modal.querySelector(".admin-modal-save").addEventListener("click", function () {
      var checkboxes = modal.querySelectorAll('input[type="checkbox"]');
      var selectedUsers = [];
      for (var ci = 0; ci < checkboxes.length; ci++) {
        if (checkboxes[ci].checked) selectedUsers.push(checkboxes[ci].value);
      }
      apiPut("/api/admin/projects/" + slug + "/users", { allowedUsers: selectedUsers }).then(function (data) {
        if (data.ok) {
          showToast("Project access updated");
          modal.remove();
          loadProjectsTab(parentBody);
        } else {
          showToast(data.error || "Failed to update access");
        }
      }).catch(function () {
        showToast("Failed to update access");
      });
    });
  }).catch(function () {
    showToast("Failed to load project access info");
  });
}
