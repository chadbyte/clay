// Session-owned shared skill catalog.
// ----------------------------------
// Keeps personal skill names out of project-wide session-manager state while
// retaining vendor commands separately for hydration and session switching.

var skillDiscovery = require("./skill-discovery");

function createSessionSkillCatalog(opts) {
  opts = opts || {};
  var cwd = opts.cwd;
  var osUsers = !!opts.osUsers;
  var getLinuxUser = opts.getLinuxUser || function () { return null; };
  var resolveUser = opts.resolveUser || require("../os-users").resolveOsUserInfo;

  function optionsFor(session) {
    if (!osUsers) return opts.homeDir ? { homeDir: opts.homeDir, env: opts.env } : {};
    var linuxUser = getLinuxUser(session);
    if (!linuxUser) return { disable: true };
    try {
      return skillDiscovery.optionsForOsUser(resolveUser(linuxUser));
    } catch (e) {
      return { disable: true };
    }
  }

  function hydrate(session) {
    if (!session) return [];
    var discovered = skillDiscovery.discoverSkills(cwd, optionsFor(session));
    var names = discovered.map(function (skill) { return skill.name; });
    session.skillNames = names;
    var vendorCommands = Array.isArray(session.vendorSlashCommands) ? session.vendorSlashCommands : [];
    var combined = vendorCommands.slice();
    for (var i = 0; i < names.length; i++) {
      if (combined.indexOf(names[i]) === -1) combined.push(names[i]);
    }
    session.slashCommands = combined;
    session.slashCommandsByVendor = session.slashCommandsByVendor || {};
    session.slashCommandsByVendor[session.vendor || "claude"] = combined;
    return combined;
  }

  return { hydrate: hydrate, optionsFor: optionsFor };
}

module.exports = { createSessionSkillCatalog: createSessionSkillCatalog };
