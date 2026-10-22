// Deliver new Project Log comments to the session responsible for the
// canonical entry. A busy Driver gets an isolated hidden reviewer so feedback
// never waits behind unrelated work in the visible conversation.

function attachProjectLogFeedbackDelivery(ctx) {
  var sm = ctx.sm;
  var getSdk = ctx.getSdk;
  var onProcessingChanged = ctx.onProcessingChanged || function () {};
  var getLinuxUserForSession = ctx.getLinuxUserForSession || function () { return null; };

  function sessionForAuthor(author) {
    if (!author || author.type !== "session" || !author.sessionKey) return null;
    var match = null;
    sm.sessions.forEach(function (session) {
      if (match || !session || session.destroying || session.hidden) return;
      if (session.cliSessionId !== author.sessionKey && "local:" + session.localId !== author.sessionKey) return;
      if ((session.ownerId || null) !== (author.userId || null)) return;
      if (sm.sessions.get(session.localId) !== session) return;
      match = session;
    });
    return match;
  }

  function findAuthorSession(entry) {
    return sessionForAuthor(entry && entry.updatedBy) || sessionForAuthor(entry && entry.createdBy);
  }

  function startImmediateReviewer(source, entry, text, sdk) {
    if (!sm.createSessionRaw || !sm.deleteSessionQuiet) return false;
    var reviewer = sm.createSessionRaw({
      ownerId: source.ownerId || null,
      sessionVisibility: "private",
      vendor: source.vendor || null,
      model: source.model || null,
      effort: source.effort || null,
      permissionMode: source.permissionMode || null,
    });
    reviewer.hidden = true;
    reviewer.title = "Project Log review";
    reviewer.singleTurn = true;
    reviewer.projectLogReview = { ref: entry.ref };
    reviewer.isProcessing = true;
    reviewer.sentToolResults = {};
    reviewer.onQueryComplete = function () {
      setImmediate(function () { sm.deleteSessionQuiet(reviewer.localId); });
    };
    sm.sendAndRecord(reviewer, {
      type: "user_message",
      text: text,
      _internal: true,
      projectLogFeedback: true,
      projectLogRef: entry.ref,
    });
    Promise.resolve(sdk.startQuery(reviewer, text, null, getLinuxUserForSession(reviewer))).catch(function (error) {
      reviewer.isProcessing = false;
      sm.sendAndRecord(reviewer, {
        type: "error",
        text: "Could not review Project Log feedback: " + (error.message || String(error)),
        _internal: true,
      });
      sm.deleteSessionQuiet(reviewer.localId);
    });
    return true;
  }

  function feedbackPrompt(entry) {
    return "[Project Log feedback]\n" +
      "A user added a comment to " + entry.ref + ". Review the pending feedback now with list_log_feedback, " +
      "then resolve this specific comment through review_log_comment. Apply supported corrections to the canonical " +
      "entry; otherwise clarify or decline with a concise reason. Do not treat this internal notification as user " +
      "chat or answer it only in the conversation.\n" +
      "[End Project Log feedback]";
  }

  function deliver(entry) {
    if (!entry || !entry.ref || !entry.pendingFeedbackCount) return false;
    var session = findAuthorSession(entry);
    var sdk = getSdk();
    if (!session || !sdk) return false;
    // With Project Logs off for this person the Driver has no Logbook tools, so
    // the comment stays pending for them instead of starting a futile turn.
    if (ctx.agentBehavior && ctx.agentBehavior.modeNow(session, "logs") === "off") return false;
    var text = feedbackPrompt(entry);
    if (session.isProcessing && startImmediateReviewer(session, entry, text, sdk)) return true;
    sm.sendAndRecord(session, {
      type: "user_message",
      text: text,
      _internal: true,
      projectLogFeedback: true,
      projectLogRef: entry.ref,
    });
    session.lastActivity = Date.now();
    if (!session.isProcessing) {
      session.isProcessing = true;
      session.sentToolResults = {};
      onProcessingChanged();
      sm.sendToSession(session, { type: "status", status: "processing" });
    }
    if (!sdk.pushMessage(session, text)) {
      session._queryStartTs = Date.now();
      Promise.resolve(sdk.startQuery(session, text, null, getLinuxUserForSession(session))).catch(function (error) {
        session.isProcessing = false;
        sm.sendAndRecord(session, {
          type: "error",
          text: "Could not deliver Project Log feedback: " + (error.message || String(error)),
          _internal: true,
        });
        onProcessingChanged();
      });
    }
    sm.broadcastSessionList();
    return true;
  }

  return {
    deliver: deliver,
    findAuthorSession: findAuthorSession,
  };
}

module.exports = { attachProjectLogFeedbackDelivery: attachProjectLogFeedbackDelivery };
