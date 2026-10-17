// project-start-path.js - Pure path helpers for the project-start dialog (no DOM, no store)

function trimTrailing(p) {
  var out = String(p || "");
  while (out.length > 1 && /[\\/]$/.test(out) && !/^[A-Za-z]:[\\/]$/.test(out)) out = out.slice(0, -1);
  return out;
}

export function baseName(dir) {
  var p = trimTrailing(dir);
  if (p === "/" || /^[A-Za-z]:[\\/]$/.test(p)) return p;
  var parts = p.split(/[\\/]/);
  return parts[parts.length - 1] || p;
}

export function parentOf(dir) {
  var p = trimTrailing(dir);
  var idx = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  if (idx < 0) return null;
  if (idx === 0) return p.length > 1 ? "/" : null;
  if (/^[A-Za-z]:$/.test(p.slice(0, idx))) return p.slice(0, idx + 1);
  return p.slice(0, idx);
}

// Last `max` segments of a directory, with a flag when earlier segments are hidden.
export function breadcrumbSegments(dir, max) {
  var p = trimTrailing(dir);
  var limit = max || 3;
  var parts = p.split(/[\\/]/).filter(function (part) { return part.length > 0; });
  if (parts.length === 0) return { truncated: false, segments: [p || "/"] };
  return { truncated: parts.length > limit, segments: parts.slice(-limit) };
}

function ordinaryProjectParent(state) {
  var projects = Array.isArray(state.projectsHubList) ? state.projectsHubList : [];
  for (var i = 0; i < projects.length; i++) {
    var project = projects[i];
    if (project && project.slug === state.currentSlug && !project.isMate && typeof project.path === "string" && project.path) {
      return parentOf(project.path);
    }
  }
  return null;
}

// Ordered starting directories to try. Each one is only a request; the server decides whether
// the signed-in user may list it, and the next candidate is tried when it cannot.
export function initialCandidates(state) {
  var out = [];
  var users = Array.isArray(state.cachedAllUsers) ? state.cachedAllUsers : [];
  var me = null;
  for (var i = 0; i < users.length; i++) if (users[i].id === state.myUserId) me = users[i];
  if (state.isOsUsers && me && me.role !== "admin" && me.linuxUser) {
    out.push("/home/" + me.linuxUser);
    return out;
  }
  var near = ordinaryProjectParent(state);
  if (near) out.push(near);
  out.push("~");
  return out;
}
