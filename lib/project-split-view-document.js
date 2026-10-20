var layout = require("./split-view-layout");

function validDocument(value) {
  if (!value || value.version !== 1 || !value.projects || typeof value.projects !== "object" || Array.isArray(value.projects)) return false;
  var projectSlugs = Object.keys(value.projects);
  for (var i = 0; i < projectSlugs.length; i++) {
    var project = value.projects[projectSlugs[i]];
    if (!project || !project.owners || typeof project.owners !== "object" || Array.isArray(project.owners)) return false;
    var ownerKeys = Object.keys(project.owners);
    for (var j = 0; j < ownerKeys.length; j++) {
      var record = project.owners[ownerKeys[j]];
      if (!record || !(record.ownerId === null || typeof record.ownerId === "string") ||
          !(record.linuxUser === null || typeof record.linuxUser === "string") ||
          !Number.isInteger(record.revision) || record.revision < 0 || !Array.isArray(record.views)) return false;
      var ids = [], memberships = [];
      var ownerIdForKey = ownerKeys[j] === "default" ? null : ownerKeys[j].slice(5);
      if (ownerKeys[j] !== "default" && (ownerKeys[j].slice(0, 5) !== "user:" || !ownerIdForKey || ownerIdForKey !== record.ownerId)) return false;
      if (ownerKeys[j] === "default" && record.ownerId !== null) return false;
      for (var k = 0; k < record.views.length; k++) {
        var checked = layout.validateViewShape(record.views[k]);
        if (!checked.ok || record.views[k].revision > record.revision || ids.indexOf(record.views[k].id) !== -1) return false;
        ids.push(record.views[k].id);
        for (var m = 0; m < checked.origins.length; m++) {
          if (memberships.indexOf(checked.origins[m]) !== -1) return false;
          memberships.push(checked.origins[m]);
        }
      }
    }
  }
  return true;
}

module.exports = { validDocument: validDocument };
