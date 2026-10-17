// Shared reply helpers for the project-start dialog (browse_dir and add/create/clone results).
// A string requestId on the request is echoed on its reply so the client can drop stale answers.

var path = require("path");

function requestIdOf(msg) {
  return msg && typeof msg.requestId === "string" && msg.requestId.length <= 64 ? msg.requestId : undefined;
}

// Canonical listing metadata. `dir` is the directory whose children are listed, `prefix` is
// non-empty when the requested path did not exist or was not a directory, and `parent` is set
// only when the caller may list the parent as well.
function browseMeta(msg, dir, prefix, canList) {
  var parent = path.dirname(dir);
  return {
    requestId: requestIdOf(msg),
    dir: dir,
    prefix: prefix || "",
    parent: parent !== dir && (!canList || canList(parent)) ? parent : null,
  };
}

function withRequestId(msg, payload) {
  var id = requestIdOf(msg);
  if (id !== undefined) payload.requestId = id;
  return payload;
}

module.exports = { requestIdOf: requestIdOf, browseMeta: browseMeta, withRequestId: withRequestId };
