function attachIssueLinks(ctx) {
  return function resolve(ws, msg) {
    var result = { type: "issue_reference_result", ref: msg.ref, requestId: msg.requestId };
    try {
      if (!/^issue:[A-Za-z0-9_-]{24}$/.test(msg.ref)) throw new Error("Invalid issue reference.");
      var found = null;
      for (var pair of ctx.projects) {
        var bound = ctx.service && ctx.service.bindUser({ projectSlug: pair[0], userId: ws._clayUser && ws._clayUser.id });
        if (!bound) continue;
        try { var entry = bound.readIssue({ ref: msg.ref }); found = { projectSlug: pair[0], ref: entry.ref, title: entry.title, status: entry.status, revision: entry.revision }; break; } catch (error) { /* Only visible records can become targets. */ }
      }
      if (!found) throw new Error("Issue is unavailable.");
      result.target = found;
    } catch (error) { result.error = error.message; }
    ctx.sendMessage(ws, result);
  };
}
module.exports = { attachIssueLinks: attachIssueLinks };
