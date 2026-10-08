// The project-scoped New session default (the provider only), kept on the
// project's own config entry. Worktrees (slug "<parent>--<name>") read their
// parent project's default and cannot set their own. Pure over a config object
// and an injected save function so the daemon callbacks are directly testable.

var access = require("./daemon-project-access");

function findProject(config, slug) {
  var projects = config && Array.isArray(config.projects) ? config.projects : [];
  for (var i = 0; i < projects.length; i++) if (projects[i].slug === slug) return projects[i];
  return null;
}

function clean(preference) {
  if (!preference || typeof preference.vendor !== "string" || !preference.vendor) return null;
  return { vendor: preference.vendor };
}

function getNewSessionDefault(config, slug) {
  var owner = findProject(config, access.parentSlugFor(slug) || slug);
  return { preference: owner ? clean(owner.newSessionDefault) : null };
}

// A failed save leaves the in-memory config exactly as it was, so the daemon
// never reports as saved something that is not on disk.
function setNewSessionDefault(config, slug, preference, save) {
  if (access.parentSlugFor(slug)) return { ok: false, error: "Worktrees inherit the project default from their parent project." };
  var project = findProject(config, slug);
  if (!project) return { ok: false, error: "Project not found" };
  var had = Object.prototype.hasOwnProperty.call(project, "newSessionDefault");
  var previous = project.newSessionDefault;
  var next = clean(preference);
  if (next) project.newSessionDefault = next;
  else delete project.newSessionDefault;
  try {
    save(config);
  } catch (error) {
    if (had) project.newSessionDefault = previous;
    else delete project.newSessionDefault;
    return { ok: false, error: "The project default could not be saved." };
  }
  return { ok: true };
}

module.exports = { getNewSessionDefault: getNewSessionDefault, setNewSessionDefault: setNewSessionDefault };
