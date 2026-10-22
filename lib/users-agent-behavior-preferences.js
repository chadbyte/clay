// Per-account storage for the Personal "Agent behavior" policy. Only explicit
// choices are stored, so an account with no record keeps today's behavior.
var schema = require("./agent-behavior-schema");

function attachAgentBehaviorPreferences(deps) {
  var loadUsers = deps.loadUsers;
  var saveUsers = deps.saveUsers;

  function find(data, userId) {
    for (var i = 0; i < data.users.length; i++) {
      if (data.users[i].id === userId) return data.users[i];
    }
    return null;
  }

  function getAgentBehavior(userId) {
    var user = find(loadUsers(), userId);
    return schema.normalize(user && user.agentBehavior);
  }

  // Merge into the stored explicit choices so two tabs changing different
  // settings never overwrite each other.
  function updateAgentBehavior(userId, changes) {
    var checked = schema.validateChanges(changes);
    if (checked.error) return { error: checked.error };
    var data = loadUsers();
    var user = find(data, userId);
    if (!user) return { error: "User not found" };
    var explicit = Object.assign({}, schema.explicit(user.agentBehavior), checked.value);
    user.agentBehavior = explicit;
    try { saveUsers(data); } catch (error) { return { error: "Could not save agent behavior" }; }
    return { ok: true, policy: schema.normalize(explicit) };
  }

  return { getAgentBehavior: getAgentBehavior, updateAgentBehavior: updateAgentBehavior };
}

module.exports = { attachAgentBehaviorPreferences: attachAgentBehaviorPreferences };
