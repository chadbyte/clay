import { escapeHtml } from './utils.js';
import { iconHtml, refreshIcons } from './icons.js';

var projectAccessPopover = null;

function closeAccessOnOutside(e) {
  if (projectAccessPopover && !projectAccessPopover.contains(e.target)) closeProjectAccessPopover();
}

function closeAccessOnEscape(e) {
  if (e.key === "Escape") closeProjectAccessPopover();
}

export function closeProjectAccessPopover() {
  if (!projectAccessPopover) return;
  projectAccessPopover.remove();
  projectAccessPopover = null;
  document.removeEventListener("click", closeAccessOnOutside);
  document.removeEventListener("keydown", closeAccessOnEscape);
}

function positionPopover(popover, anchorEl) {
  var rect = anchorEl.getBoundingClientRect();
  popover.style.position = "fixed";
  popover.style.left = (rect.right + 8) + "px";
  popover.style.top = rect.top + "px";
  popover.style.zIndex = "9999";
  var popRect = popover.getBoundingClientRect();
  if (popRect.right > window.innerWidth - 8) popover.style.left = (rect.left - popRect.width - 8) + "px";
  if (popRect.bottom > window.innerHeight - 8) popover.style.top = (window.innerHeight - popRect.height - 8) + "px";
}

function selectedExactUsers(popover) {
  var selected = [];
  popover.querySelectorAll('.project-access-user-item input[type="checkbox"]:checked').forEach(function (checkbox) {
    if (!checkbox.disabled || checkbox.dataset.explicit === "true") selected.push(checkbox.dataset.uid);
  });
  return selected;
}

function renderAccessPopover(popover, slug, access, allUsers) {
  var visibility = access.visibility || "public";
  var isWorktree = access.isWorktree === true;
  var allowedUsers = isWorktree ? (access.worktreeAllowedUsers || []) : (access.allowedUsers || []);
  var inheritedUsers = isWorktree ? (access.parentAllowedUsers || []) : [];
  var ownerId = access.ownerId;
  var selectableUsers = allUsers.filter(function (user) { return user.id !== ownerId; });
  var html = '';
  html += '<div class="project-access-header">';
  html += '<span class="project-access-title">' + (isWorktree ? 'Worktree Access' : 'Project Access') + '</span>';
  html += '<button class="project-access-close" aria-label="Close access settings">&times;</button>';
  html += '</div>';

  if (isWorktree) {
    var scopeTitle = visibility === "public" ? "Public parent project" : "This worktree only";
    var scopeText = visibility === "public"
      ? "Every authenticated user can access this worktree. Exact grants are retained if the parent becomes private."
      : "Entire-project access is inherited automatically.";
    html += '<div class="project-access-scope">';
    html += '<span class="project-access-scope-icon">' + iconHtml(visibility === "public" ? "globe" : "git-branch") + '</span>';
    html += '<span><strong>' + scopeTitle + '</strong><small>' + scopeText + '</small></span>';
    html += '</div>';
  } else {
    html += '<div class="project-access-section">';
    html += '<label class="project-access-label">Visibility</label>';
    html += '<div class="project-access-vis-row">';
    html += '<button class="project-access-vis-btn' + (visibility === "private" ? ' active' : '') + '" data-vis="private">' + iconHtml("lock") + ' Private</button>';
    html += '<button class="project-access-vis-btn' + (visibility === "public" ? ' active' : '') + '" data-vis="public">' + iconHtml("globe") + ' Public</button>';
    html += '</div></div>';
  }

  html += '<div class="project-access-section project-access-users-section"' + (!isWorktree && visibility !== "private" ? ' style="display:none"' : '') + '>';
  html += '<label class="project-access-label">' + (isWorktree ? 'People with exact access' : 'Allowed Users') + '</label>';
  html += '<div class="project-access-user-list">';
  for (var i = 0; i < selectableUsers.length; i++) {
    var user = selectableUsers[i];
    var explicit = allowedUsers.indexOf(user.id) !== -1;
    var inherited = inheritedUsers.indexOf(user.id) !== -1;
    html += '<label class="project-access-user-item' + (inherited ? ' is-inherited' : '') + '">';
    html += '<input type="checkbox" data-uid="' + user.id + '" data-explicit="' + (explicit ? 'true' : 'false') + '"' + (explicit || inherited ? ' checked' : '') + (inherited ? ' disabled' : '') + '>';
    html += '<span>' + escapeHtml(user.displayName || user.username || user.id) + '</span>';
    if (inherited) html += '<small>Entire project</small>';
    html += '</label>';
  }
  if (selectableUsers.length === 0) html += '<div class="project-access-empty">No other users</div>';
  html += '</div></div>';
  popover.innerHTML = html;
  refreshIcons();

  popover.querySelector(".project-access-close").addEventListener("click", closeProjectAccessPopover);
  popover.querySelectorAll(".project-access-vis-btn").forEach(function (button) {
    button.addEventListener("click", function () {
      var visibilityValue = button.dataset.vis;
      popover.querySelectorAll(".project-access-vis-btn").forEach(function (item) { item.classList.remove("active"); });
      button.classList.add("active");
      var usersSection = popover.querySelector(".project-access-users-section");
      if (usersSection) usersSection.style.display = visibilityValue === "private" ? "" : "none";
      fetch("/api/admin/projects/" + encodeURIComponent(slug) + "/visibility", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visibility: visibilityValue }),
      });
    });
  });
  popover.querySelectorAll('.project-access-user-item input[type="checkbox"]').forEach(function (checkbox) {
    checkbox.addEventListener("change", function () {
      fetch("/api/admin/projects/" + encodeURIComponent(slug) + "/users", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allowedUsers: selectedExactUsers(popover) }),
      });
    });
  });
}

export function showProjectAccessPopover(anchorEl, slug) {
  closeProjectAccessPopover();
  var popover = document.createElement("div");
  popover.className = "project-access-popover";
  popover.innerHTML = '<div class="project-access-loading">Loading...</div>';
  popover.addEventListener("click", function (e) { e.stopPropagation(); });
  document.body.appendChild(popover);
  projectAccessPopover = popover;
  requestAnimationFrame(function () { positionPopover(popover, anchorEl); });
  setTimeout(function () {
    document.addEventListener("click", closeAccessOnOutside);
    document.addEventListener("keydown", closeAccessOnEscape);
  }, 0);
  Promise.all([
    fetch("/api/admin/projects/" + encodeURIComponent(slug) + "/access").then(function (response) { return response.json(); }),
    fetch("/api/admin/users").then(function (response) { return response.json(); }),
  ]).then(function (results) {
    if (results[0].error || results[1].error) {
      popover.innerHTML = '<div class="project-access-loading">Failed to load</div>';
      return;
    }
    renderAccessPopover(popover, slug, results[0], results[1].users || []);
  }).catch(function () {
    popover.innerHTML = '<div class="project-access-loading">Failed to load</div>';
  });
}
