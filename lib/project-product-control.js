var userInput = require("./yoke/user-input");
var provenance = require("./session-provenance");
var deletion = require("./project-session-delete");
function attachProjectProductControl(ctx) {
  var queues = require("./project-product-session-queue").attachProductSessionQueue({ queue: ctx.queue, sm: ctx.sm, users: ctx.users, requestDrain: ctx.requestQueueDrain });
  function inspectQueue(principal, session) {
    owned(principal, session);
    if (ctx.isMate || provenance.isWorker(session) || session.spawn || ctx.isDriverOperatedSession(session)) throw new Error("Queues are controlled through their project Driver.");
    return queues.inspect(principal, session);
  }
  function owned(principal, session) {
    if (!session || ctx.sm.sessions.get(session.localId) !== session) throw new Error("Target session was deleted or replaced.");
    if (ctx.users.isMultiUser()) {
      var user = ctx.users.findUserById(principal.userId);
      if (!user || session.ownerId !== user.id || !ctx.users.canAccessProject(user.id, ctx.getProjectAccess())) throw new Error("Live target ownership or access denied.");
      return user;
    }
    if (session.ownerId && session.ownerId !== principal.singleUserOwnerId) throw new Error("Live target ownership denied.");
    return null;
  }
  function review(session, question, revalidate, presentation) {
    var owner = session.ownerId || null;
    return userInput.dispatchUserInput(function (request, respond) {
      // Presentation comes only from the bound product service, after normalization.
      if (presentation) request.questions[0].review = presentation;
      request.authorizeResponse = function (ws) {
        try {
          revalidate();
          if (ctx.users.isMultiUser() && (!ws || !ws._clayUser || ws._clayUser.id !== owner || !ctx.users.findUserById(owner))) return false;
          var tap = ws && ws._homeChatTap;
          return !!ws && ((ctx.clients.has(ws) && ws._clayActiveSession === session.localId) || (tap && tap.mateSlug === ctx.slug && tap.sessionId === session.localId));
        } catch (error) { return false; }
      };
      ctx.userInput(session)(request, respond);
    }, { questions: [{ id: "control", header: "Review change", question: question, options: [{ label: "Keep unchanged" }, { label: "Apply exact change" }], allowOther: false }] }, { source: "product-control", signal: session.abortController && session.abortController.signal });
  }
  async function apply(principal, session, action, value, revalidate, control) {
    var user = owned(principal, session);
    function current() {
      owned(principal, session);
      if (typeof revalidate !== "function") throw new Error("An exact product control revision is required.");
      revalidate();
    }
    current();
    if (ctx.isMate || provenance.isWorker(session) || session.spawn || ctx.isDriverOperatedSession(session)) throw new Error("This target is not a project Driver.");
    if (action.indexOf("queue_") === 0) return queues.apply(principal, session, control.args, current, control.requestKey);
    if (action === "vendor") return ctx.vendor.setVendor(session, value, current);
    if (action === "vendor_new_session") return ctx.vendor.newSession(session, value, current);
    if (action === "runtime") return ctx.runtime.change(session, value, current);
    if (action === "rename") return ctx.actions.rename(session, value);
    if (action === "force_stop") return ctx.actions.forceStop(session, user);
    if (action === "stop") return ctx.actions.stop(session, user);
    if (session.taskStopRequested && action !== "delete") throw new Error("Target was stopped; explicit Driver resumption is required.");
    if (action === "model") {
      var models = (ctx.sm.modelsByVendor || {})[session.vendor || ctx.sm.defaultVendor || "claude"] || [];
      if (!models.length) throw new Error("Provider model catalog is unavailable; no model was changed.");
      var result = await ctx.selectModel(session, value, { revalidate: current });
      if (!result) throw new Error("Model change failed.");
      if (result.ok !== true && result.status !== "failed") throw new Error(result.error || "Model change failed.");
      return result;
    }
    if (action === "effort") return ctx.actions.effort(session, value, current);
    if (action === "permission") return ctx.actions.permission(session, value, null, current);
    if (action === "fork" || action === "rewind") {
      if (session.isProcessing || session._queryStarting || Object.keys(session.pendingPermissions || {}).length || Object.keys(session.pendingAskUser || {}).length) throw new Error("History changes require an idle Driver without pending approvals.");
      if (!session.cliSessionId || !(session.messageUUIDs || []).some(function (entry) { return entry.uuid === value; })) throw new Error("Choose an exact recorded checkpoint from inspection.");
      var vendor = session.vendor || ctx.sm.defaultVendor || "claude";
      var caps = (ctx.sm.capabilitiesByVendor || {})[vendor] || {};
      if (action === "fork" && !caps.fork || action === "rewind" && !caps.rollback && !caps.rewind) throw new Error("This provider does not support that history operation.");
      if (action === "fork") {
        var forked = await ctx.history.fork(session, value, null, revalidate);
        if (!forked) throw new Error("The provider did not produce a forked session.");
        return { forkedSessionRef: require("./workspace-query-service").sessionRef(ctx.slug, forked) };
      }
      return ctx.history.rewind(session, value, "chat", null, revalidate);
    }
    if (action === "delete") {
      if (user && !ctx.users.getEffectivePermissions(user, ctx.osUsers).sessionDelete) throw new Error("You do not have permission to delete sessions.");
      var plan = deletion.resolveDeletionScope(ctx.sm.sessions, [session], function (candidate) { return (candidate.ownerId || null) === (session.ownerId || null); });
      if (!plan.ok) throw new Error(plan.error);
      // A live Driver or Worker must be stopped and settled before deletion.
      if (plan.ids.some(function (id) { var item = ctx.sm.sessions.get(id); return item.isProcessing || item._queryStarting; })) throw new Error("Stop the Driver and its Workers and wait for completion before deleting them.");
      ctx.deletePlan(plan);
      return { deletedCount: plan.ids.length };
    }
    throw new Error("Unsupported product control action.");
  }
  return { requestProductControlReview: review, applyProductSessionAction: apply, inspectProductSessionQueue: inspectQueue };
}
module.exports = { attachProjectProductControl: attachProjectProductControl };
