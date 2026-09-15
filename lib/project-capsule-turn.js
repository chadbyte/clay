// Delivers a Capsule turn prompt into this Mate project.
//
// A Capsule game against a Mate needs the Mate to actually take its turns:
// when Logic passes the turn to the mate seat, this module wakes the Mate
// with a prompt telling it to snapshot the game and act. One session hosts
// the whole game (found again by session.capsuleGame.toolId), so the user
// watches a single running conversation of the Mate playing rather than a
// new session per turn. The prompt is recorded as an internal user message,
// the same shape the debate engine uses, so the transcript shows the nudge
// without pretending the human typed it.
//
// This module only carries words to the Mate. Every actual game mutation the
// Mate then makes goes through the same clay_tool_act pipeline as always.

function attachCapsuleTurn(ctx) {
  var sm = ctx.sm;

  function ownsSession(session, principal) {
    if (ctx.isMultiUser()) return !!principal.userId && session.ownerId === principal.userId;
    return !session.ownerId;
  }

  function findGameSession(principal, toolId) {
    var found = null;
    sm.sessions.forEach(function (session) {
      if (found || !session || session.hidden || session.destroying) return;
      if (!session.capsuleGame || session.capsuleGame.toolId !== toolId) return;
      if (!ownsSession(session, principal)) return;
      found = session;
    });
    return found;
  }

  async function createGameSession(principal, options) {
    var selection = await ctx.resolveModel(principal);
    if (!selection || selection.status !== "ready" || !selection.vendor || !selection.model) {
      throw new Error(selection && selection.error ? selection.error : "No configured model is available for the Mate.");
    }
    var create = typeof sm.createSessionRaw === "function" ? sm.createSessionRaw : sm.createSession;
    var session = create.call(sm, {
      ownerId: principal.userId || null,
      vendor: selection.vendor,
      model: selection.model,
      effort: selection.effort || null,
    });
    session.title = (options.toolName || options.toolId) + " game";
    session.capsuleGame = { toolId: options.toolId };
    return session;
  }

  async function deliverCapsuleTurn(principal, options) {
    if (!principal || !options || !options.toolId || !options.text) {
      throw new Error("A bound owner, toolId, and turn text are required.");
    }
    var sdk = ctx.getSdk();
    if (!sdk || typeof sdk.startQuery !== "function") throw new Error("Mate project runtime is unavailable.");
    var session = findGameSession(principal, options.toolId);
    var created = false;
    if (!session) {
      session = await createGameSession(principal, options);
      created = true;
    }
    // Recorded as a dedicated event, not a user message: the transcript shows
    // a short system note (see historyToHomeChat) instead of pretending the
    // human typed the delivery prompt. The full prompt still reaches the
    // model through the query below.
    sm.sendAndRecord(session, {
      type: "capsule_turn",
      text: options.text,
      toolId: options.toolId,
      toolName: options.toolName || options.toolId,
      kind: options.kind || "turn",
    });
    session.isProcessing = true;
    session.lastActivity = Date.now();
    sm.broadcastSessionList();
    try {
      var delivered = typeof sdk.pushMessage === "function" ? sdk.pushMessage(session, options.text) : false;
      if (!delivered) await Promise.resolve(sdk.startQuery(session, options.text, undefined, ctx.getLinuxUserForSession(session)));
    } catch (error) {
      session.isProcessing = false;
      sm.sendAndRecord(session, { type: "error", text: "Capsule turn could not start: " + (error && error.message ? error.message : String(error)) });
      sm.broadcastSessionList();
      throw error;
    }
    // The reference shape the home chat surface opens sessions by.
    return {
      session: session,
      created: created,
      reference: (typeof session.cliSessionId === "string" && session.cliSessionId) || "local:" + session.localId,
    };
  }

  return { deliverCapsuleTurn: deliverCapsuleTurn };
}

module.exports = { attachCapsuleTurn: attachCapsuleTurn };
