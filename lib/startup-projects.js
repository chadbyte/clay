// Saved project records are authoritative; filesystem availability only controls
// runtime registration. Recent-project entries must never restore access grants.
function buildStartupProjects(config, recent, options) {
  var projects = [];
  var paths = new Set();
  var slugs = [];
  var removed = new Set((config && config.removedProjects || []).map(function (p) { return p.path; }));
  (config && config.projects || []).forEach(function (p) {
    if (paths.has(p.path)) return;
    projects.push(Object.assign({}, p));
    paths.add(p.path);
    slugs.push(p.slug);
  });

  function add(project) {
    if (paths.has(project.path) || removed.has(project.path)) return;
    if (!options.existsSync(project.path)) return;
    var slug = options.generateSlug(project.path, slugs);
    projects.push({
      path: project.path,
      slug: slug,
      title: project.title || undefined,
      icon: project.icon || undefined,
      addedAt: project.addedAt || Date.now(),
    });
    paths.add(project.path);
    slugs.push(slug);
  }

  if (options.addCwd) {
    var cwdRecent = (recent || []).find(function (p) { return p.path === options.cwd; });
    add(cwdRecent || { path: options.cwd });
  }
  (recent || []).forEach(function (p) {
    if (p.path !== options.cwd) add(p);
  });
  return projects;
}

module.exports = { buildStartupProjects: buildStartupProjects };
