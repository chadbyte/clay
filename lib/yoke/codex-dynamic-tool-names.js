// Reversible Codex transport names for Clay dynamic tools.
//
// Codex app-server (rust-v0.162.1 validate_dynamic_tools) rejects a
// thread/start whose dynamic tool names do not match ^[a-zA-Z0-9_-]+$, exceed
// 128 characters, repeat, or are "mcp" / start with "mcp__". Clay keeps its
// original names (for example mcp__server__tool) for dispatch, permissions and
// activity, and only the Codex wire uses a deterministic alias. Determinism
// lets a resumed thread's persisted catalog resolve against a rebuilt catalog.

var crypto = require("crypto");

var MAX_NAME_LENGTH = 128;
var ALIAS_PREFIX = "clay__";
var HASH_LENGTH = 16;
var IDENTIFIER = /^[A-Za-z0-9_-]+$/;

function isReserved(name) {
  return name === "mcp" || name.indexOf("mcp__") === 0;
}

// True when Codex accepts the name as-is and it cannot be mistaken for an alias.
function isPlainName(name) {
  return typeof name === "string" && name.length > 0 && name.length <= MAX_NAME_LENGTH
    && IDENTIFIER.test(name) && !isReserved(name) && name.indexOf(ALIAS_PREFIX) !== 0;
}

function transportName(name) {
  if (typeof name !== "string" || !name) throw new Error("Dynamic tool names must be non-empty strings.");
  if (isPlainName(name)) return name;
  var hash = crypto.createHash("sha256").update(name, "utf8").digest("hex").slice(0, HASH_LENGTH);
  var readable = name.replace(/^mcp__/, "").replace(/[^A-Za-z0-9_-]/g, "_");
  var room = MAX_NAME_LENGTH - ALIAS_PREFIX.length - 2 - HASH_LENGTH;
  return ALIAS_PREFIX + readable.slice(0, room) + "__" + hash;
}

// Build the exact alias map for one query's catalog. Repeated identical
// originals resolve to the same handler, so they are advertised once. Two
// different originals sharing an alias fail closed instead of guessing.
function createCatalog(defs) {
  var byTransport = new Map();
  var byOriginal = new Map();
  var advertised = [];
  (defs || []).forEach(function (def) {
    var original = def && def.name;
    var alias = transportName(original);
    if (byOriginal.has(original)) return;
    if (byTransport.has(alias)) {
      throw new Error("Codex dynamic tool names collide: " + byTransport.get(alias) + " and " + original);
    }
    byTransport.set(alias, original);
    byOriginal.set(original, alias);
    advertised.push({ def: def, name: alias });
  });

  // Map a Codex call back to the original Clay name. Plain names keep the
  // existing live-catalog lookup; aliases must belong to this catalog.
  function resolve(tool, namespace) {
    if (namespace !== undefined && namespace !== null && namespace !== "") {
      return { error: "Clay does not register namespaced dynamic tools: " + namespace };
    }
    if (typeof tool !== "string" || !tool) return { error: "Dynamic tool call has no tool name." };
    if (byTransport.has(tool)) return { name: byTransport.get(tool) };
    if (isPlainName(tool)) return { name: tool };
    return { error: "Session tool is not in this conversation's current catalog: " + tool };
  }

  function displayName(tool) {
    return byTransport.has(tool) ? byTransport.get(tool) : tool;
  }

  return { advertised: advertised, resolve: resolve, displayName: displayName };
}

module.exports = {
  MAX_NAME_LENGTH: MAX_NAME_LENGTH,
  ALIAS_PREFIX: ALIAS_PREFIX,
  isPlainName: isPlainName,
  transportName: transportName,
  createCatalog: createCatalog,
};
