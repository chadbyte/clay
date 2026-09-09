// Groups visible parent projects with their visible worktrees. A worktree whose
// parent is not in the authorized projection remains a standalone item.

export function groupProjects(projects) {
  var source = Array.isArray(projects) ? projects : [];
  var parentSlugs = {};
  var parents = [];
  var wtByParent = {};
  for (var i = 0; i < source.length; i++) {
    if (!source[i].isWorktree) parentSlugs[source[i].slug] = true;
  }
  for (var j = 0; j < source.length; j++) {
    var project = source[j];
    if (project.isWorktree && project.parentSlug && parentSlugs[project.parentSlug]) {
      if (!wtByParent[project.parentSlug]) wtByParent[project.parentSlug] = [];
      wtByParent[project.parentSlug].push(project);
    } else {
      parents.push(project);
    }
  }
  return { parents: parents, wtByParent: wtByParent };
}
