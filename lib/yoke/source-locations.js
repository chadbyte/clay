var path = require("path");
// Legacy imported skill format; Clay-only skills use their own private root.
function legacySkillRoot(base) { return path.join(base, ".claude", "skills"); }
module.exports = { legacySkillRoot: legacySkillRoot };
