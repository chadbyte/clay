// Shared validation for configured browser origins and WebSocket handshakes.
var MAX_ORIGINS = 100;
var MAX_ORIGIN_LENGTH = 2048;

function invalid(reason) {
  var error = new Error(reason);
  error.reason = reason;
  return error;
}

function normalizeOrigin(value) {
  if (typeof value !== "string") throw invalid("must be text, for example https://clay.example.com.");
  if (value.length > MAX_ORIGIN_LENGTH) throw invalid("is longer than " + MAX_ORIGIN_LENGTH + " characters.");
  if (value.indexOf("*") !== -1) throw invalid("cannot contain wildcards (*). List each address separately.");
  if (!/^https?:\/\//i.test(value)) throw invalid("must start with http:// or https://.");
  if (!/^https?:\/\/[^\s/?#\\]+\/?$/i.test(value)) {
    throw invalid("cannot include a path, query, fragment, or spaces. Use only the scheme, host, and optional port.");
  }
  var url;
  try { url = new URL(value); } catch (e) { throw invalid("is not a valid address. Check the host name and port."); }
  if (url.username || url.password) throw invalid("cannot include a username or password.");
  return url.origin;
}

function normalizeAllowedOrigins(values) {
  if (!Array.isArray(values)) throw invalid("Allowed origins must be a list.");
  if (values.length > MAX_ORIGINS) throw invalid("Enter at most " + MAX_ORIGINS + " allowed origins.");
  var normalized = [];
  for (var i = 0; i < values.length; i++) {
    try {
      normalized.push(normalizeOrigin(values[i]));
    } catch (e) {
      var error = invalid("Entry " + (i + 1) + " " + e.reason);
      error.index = i;
      error.entryReason = e.reason;
      throw error;
    }
  }
  return Array.from(new Set(normalized));
}

// Describes stored entries for the editor without dropping invalid manual edits.
function describeConfiguredOrigins(raw) {
  if (raw === undefined || raw === null) return { allowedOrigins: [], invalid: [] };
  var list = Array.isArray(raw) ? raw : [raw];
  var entries = [];
  var problems = [];
  for (var i = 0; i < list.length; i++) {
    var value = list[i];
    entries.push(typeof value === "string" ? value : JSON.stringify(value) || String(value));
    try { normalizeOrigin(value); } catch (e) { problems.push({ index: i, reason: e.reason }); }
  }
  if (!Array.isArray(raw)) problems.unshift({ index: 0, reason: "is not stored as a list. Save to store it correctly." });
  return { allowedOrigins: entries, invalid: problems };
}

function isAllowedOrigin(origin, host, allowedOrigins) {
  // Non-browser clients may omit Origin; authentication is still required.
  if (origin === undefined) return true;
  try {
    var normalized = normalizeOrigin(origin);
    var configured = Array.isArray(allowedOrigins) ? allowedOrigins : [];
    for (var i = 0; i < configured.length; i++) {
      try {
        if (normalizeOrigin(configured[i]) === normalized) return true;
      } catch (e) { /* Invalid manual config entries never grant access. */ }
    }
    // Preserve Host-based access through TLS-terminating proxies. Forwarded
    // headers are deliberately not trusted; rewritten hosts need an allowlist.
    if (typeof host !== "string" || !host.trim()) return false;
    var protocol = new URL(normalized).protocol;
    return normalizeOrigin(protocol + "//" + host) === normalized;
  } catch (e) {
    return false;
  }
}

function saveAllowedOrigins(config, origins, saveConfig) {
  var normalized = normalizeAllowedOrigins(origins);
  var nextConfig = Object.assign({}, config, { allowedOrigins: normalized });
  saveConfig(nextConfig);
  config.allowedOrigins = normalized;
}

module.exports = {
  normalizeAllowedOrigins: normalizeAllowedOrigins,
  describeConfiguredOrigins: describeConfiguredOrigins,
  isAllowedOrigin: isAllowedOrigin,
  saveAllowedOrigins: saveAllowedOrigins,
};
