// Check if text looks like env format: first line starts with a valid VAR_NAME=
export function looksLikeEnv(text) {
  var first = text.split("\n")[0].trim();
  if (first.indexOf("export ") === 0) first = first.substring(7);
  return /^[A-Za-z_][A-Za-z0-9_]*=/.test(first);
}

export function parseEnvString(str) {
  var pairs = [];
  if (!str) return pairs;
  var lines = str.split("\n");
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (!line || line.charAt(0) === "#") continue;
    // Strip leading "export "
    if (line.indexOf("export ") === 0) line = line.substring(7);
    var eq = line.indexOf("=");
    if (eq === -1) continue;
    var key = line.substring(0, eq).trim();
    var val = line.substring(eq + 1).trim();
    // Saved values are JSON-quoted so shell metacharacters remain data.
    if (val.charAt(0) === '"' && val.charAt(val.length - 1) === '"') {
      try { val = JSON.parse(val); } catch (e) { val = val.substring(1, val.length - 1); }
    } else if (val.charAt(0) === "'" && val.charAt(val.length - 1) === "'") {
      val = val.substring(1, val.length - 1);
    }
    if (key) pairs.push({ key: key, value: val });
  }
  return pairs;
}

export function serializeEnvValue(value) {
  return JSON.stringify(value == null ? "" : String(value));
}
