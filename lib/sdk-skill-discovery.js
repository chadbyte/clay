var skillDiscovery = require("./yoke/skill-discovery");

// Split shell command on operators (&&, ||, ;, |) while respecting quotes
// and parentheses. Returns array of command segments.
function splitShellSegments(cmd) {
  var segments = [];
  var current = "";
  var inSingle = false;
  var inDouble = false;
  var parenDepth = 0;
  var i = 0;
  while (i < cmd.length) {
    var ch = cmd[i];

    // Handle escape
    if (ch === "\\" && i + 1 < cmd.length && !inSingle) {
      current += ch + cmd[i + 1];
      i += 2;
      continue;
    }

    // Quote tracking
    if (ch === "'" && !inDouble) { inSingle = !inSingle; current += ch; i++; continue; }
    if (ch === '"' && !inSingle) { inDouble = !inDouble; current += ch; i++; continue; }

    // Inside quotes: no splitting
    if (inSingle || inDouble) { current += ch; i++; continue; }

    // Parentheses/subshell tracking
    if (ch === "(" || ch === "$" && i + 1 < cmd.length && cmd[i + 1] === "(") {
      parenDepth++;
      current += ch;
      i++;
      continue;
    }
    if (ch === ")" && parenDepth > 0) {
      parenDepth--;
      current += ch;
      i++;
      continue;
    }

    // Inside subshell: no splitting
    if (parenDepth > 0) { current += ch; i++; continue; }

    // Check for operators: &&, ||, ;, |
    if (ch === "&" && i + 1 < cmd.length && cmd[i + 1] === "&") {
      segments.push(current);
      current = "";
      i += 2;
      continue;
    }
    if (ch === "|" && i + 1 < cmd.length && cmd[i + 1] === "|") {
      segments.push(current);
      current = "";
      i += 2;
      continue;
    }
    if (ch === "|") {
      segments.push(current);
      current = "";
      i++;
      continue;
    }
    if (ch === ";") {
      segments.push(current);
      current = "";
      i++;
      continue;
    }

    current += ch;
    i++;
  }
  if (current) segments.push(current);
  return segments;
}

function attachSkillDiscovery(ctx) {
  var cwd = ctx.cwd;
  var getOptions = ctx.getOptions || function () { return {}; };

  function discoverSkillDirs(options) {
    var discovered = skillDiscovery.discoverSkills(cwd, options || getOptions());
    var skills = {};
    for (var i = 0; i < discovered.length; i++) {
      skills[discovered[i].name] = discovered[i].path.replace(/\/SKILL\.md$/, "");
    }
    return skills;
  }

  function mergeSkills(sdkSkills, fsSkills) {
    var merged = new Set();
    if (Array.isArray(sdkSkills)) {
      for (var i = 0; i < sdkSkills.length; i++) {
        merged.add(sdkSkills[i]);
      }
    }
    var fsNames = Object.keys(fsSkills);
    for (var i = 0; i < fsNames.length; i++) {
      merged.add(fsNames[i]);
    }
    return merged;
  }

  return { discoverSkillDirs: discoverSkillDirs, mergeSkills: mergeSkills };
}

module.exports = { splitShellSegments: splitShellSegments, attachSkillDiscovery: attachSkillDiscovery };
