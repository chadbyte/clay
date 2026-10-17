// Project selection for settings. The settings target is independent of the
// open workspace: choosing a project here never changes currentSlug or the
// workspace WebSocket. Pure helpers plus a generation guard for async replies.

export function settingsProjectLabel(project) {
  return (project && (project.title || project.project || project.name || project.slug)) || '';
}

// Mates and the Clay project have their own settings surfaces.
export function isSettingsProject(project, permissions) {
  if (!project || !project.slug || project.isMate || /^mate-/.test(project.slug)) return false;
  return !permissions || permissions.projectSettings !== false;
}

// Authorised projects for the signed-in user (the server-filtered project
// list), the open workspace first, the rest in their existing order.
export function listSettingsProjects(projects, currentSlug, permissions) {
  var eligible = (Array.isArray(projects) ? projects : []).filter(function (project) { return isSettingsProject(project, permissions); });
  var current = eligible.filter(function (project) { return project.slug === currentSlug; });
  var others = eligible.filter(function (project) { return project.slug !== currentSlug; });
  return current.concat(others).map(function (project, index) {
    return { slug: project.slug, label: settingsProjectLabel(project), isCurrent: project.slug === currentSlug, project: project, first: index === 0 };
  });
}

// A requested slug must still be authorised; otherwise use the current
// workspace, then the first choice, then nothing.
export function resolveTargetSlug(requested, choices) {
  var list = choices || [];
  for (var i = 0; i < list.length; i++) if (list[i].slug === requested) return requested;
  return list.length ? list[0].slug : null;
}

export function findChoice(choices, slug) {
  var list = choices || [];
  for (var i = 0; i < list.length; i++) if (list[i].slug === slug) return list[i];
  return null;
}

export function optionLabel(choice) {
  return choice.isCurrent ? choice.label + ' (open workspace)' : choice.label;
}

// Every settings open, scope change and project switch takes a new token.
// Async work captures the token and ignores its result once it is stale.
export function createTargetBinding() {
  var generation = 0;
  var slug = null;
  return {
    bind: function (next) { generation += 1; slug = next || null; return generation; },
    invalidate: function () { generation += 1; slug = null; return generation; },
    isCurrent: function (token, expectedSlug) { return token === generation && (expectedSlug === undefined || expectedSlug === slug); },
    slug: function () { return slug; },
    generation: function () { return generation; }
  };
}
