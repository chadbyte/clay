var sessionVisibility = require("./session-visibility");
function attachSessionHistoryActions(ctx) {
  var sm = ctx.sm, sdk = ctx.sdk, cwd = ctx.cwd, hydrateImageRefs = ctx.hydrateImageRefs;
  var resolveSessionHome = ctx.resolveSessionHome, cancelPendingAskUser = ctx.cancelPendingAskUser;
  var onProcessingChanged = ctx.onProcessingChanged;
  async function rewind(session, uuid, mode, ws, revalidate) {
    if (session._rewindInProgress) throw new Error("Rewind already in progress.");
    session._rewindInProgress = true;
    try {
      // File restoration (delegated to adapter via sdk-bridge)
      if (mode !== "chat") {
        await sdk.rewindExecuteFiles(session, uuid);
        revalidate();
      }

      // Conversation rollback (skip for files-only mode)
      if (mode !== "files") {
        var targetIdx = -1;
        for (var i = 0; i < session.messageUUIDs.length; i++) {
          if (session.messageUUIDs[i].uuid === uuid) {
            targetIdx = i;
            break;
          }
        }

        // Codex's thread/revert cuts at a turn id, not a count. Read the
        // target entry's turnId BEFORE trimming local history below.
        var hasTurnsToRollBack = false;
        var targetTurnId = null;
        if (targetIdx >= 0) {
          targetTurnId = session.messageUUIDs[targetIdx].turnId || null;
          for (var ri = targetIdx; ri < session.messageUUIDs.length; ri++) {
            if (session.messageUUIDs[ri].type === "user") { hasTurnsToRollBack = true; break; }
          }
        }

        // Notify adapter of conversation rollback (e.g. Codex thread/revert)
        // BEFORE trimming local history below. Deliberately not caught
        // here: a failed or impossible (missing turnId) provider-side
        // rollback must abort the whole rewind via the outer catch, never
        // leave local history trimmed ahead of the real provider thread.
        if (hasTurnsToRollBack) {
          await sdk.rollbackConversation(session, targetTurnId);
          revalidate();
        }

        if (targetIdx >= 0) {
          var trimTo = session.messageUUIDs[targetIdx].historyIndex;
          for (var k = trimTo - 1; k >= 0; k--) {
            if (session.history[k].type === "user_message") {
              trimTo = k;
              break;
            }
          }
          session.history = session.history.slice(0, trimTo);
          session.messageUUIDs = session.messageUUIDs.slice(0, targetIdx);
          // Reset digest checkpoint if it points past the trimmed history
          if (typeof session._dmLastDigestedIndex === "number" && session._dmLastDigestedIndex > trimTo) {
            session._dmLastDigestedIndex = trimTo;
          }
        }

        var kept = session.messageUUIDs;
        session.lastRewindUuid = kept.length > 0 ? kept[kept.length - 1].uuid : null;
      }

      if (session.abortController) {
        try { session.abortController.abort(); } catch (e) {}
      }
      if (session.messageQueue) {
        try { session.messageQueue.end(); } catch (e) {}
      }
      session.queryInstance = null;
      session.messageQueue = null;
      session.abortController = null;
      session.blocks = {};
      session.sentToolResults = {};
      session.pendingPermissions = {};
      cancelPendingAskUser(session, "Conversation rewound");
      session.isProcessing = false;
      onProcessingChanged();

      if (sm.saveSessionFile(session) === false) throw new Error("The conversation was rewound but could not be saved.");
      if (ws) sm.switchSession(session.localId, ws, hydrateImageRefs);
      sm.sendAndRecord(session, { type: "rewind_complete", mode: mode });
      sm.broadcastSessionList();
    } finally { session._rewindInProgress = false; }
    return { mode: mode };
  }
  function saveFork(forked, ws) {
    if (sm.saveSessionFile(forked) !== false) return;
    var error = new Error("The provider fork exists and its local session is retained in memory, but the fork could not be saved. Do not create another fork to retry this save.");
    if (!ws) error.productControlResult = { status: "failed", outcome: "partial", persisted: false, runtimeEffect: "applied", retrySafe: false,
      retainedSession: true, forkedSessionRef: require("./workspace-query-service").sessionRef(ctx.slug, forked), error: error.message };
    throw error;
  }
  async function fork(session, uuid, ws, revalidate) {
    var forkTitle = (session.title || "New Session") + " (fork)";
    var result = await sdk.forkSession(session, uuid);
    revalidate();
    if (result.useLocalHistory) {
      // Copy local history up to the target UUID
      var targetIdx = -1;
      for (var fi = 0; fi < session.messageUUIDs.length; fi++) {
        if (session.messageUUIDs[fi].uuid === uuid) { targetIdx = fi; break; }
      }
      var forkHistory = [];
      if (targetIdx >= 0) {
        var trimTo = session.messageUUIDs[targetIdx].historyIndex;
        forkHistory = session.history.slice(0, trimTo);
      } else {
        forkHistory = session.history.slice();
      }
      var create = ws ? sm.createSession : sm.createSessionRaw;
      var forked = create({
        vendor: session.vendor,
        ownerId: session.ownerId || null,
        userKnowledgeOwnerId: session.userKnowledgeOwnerId || null,
        sessionVisibility: sessionVisibility.normalize(session.sessionVisibility),
      }, ws);
      forked.cliSessionId = result.sessionId;
      forked.title = forkTitle;
      forked.history = forkHistory;
      forked.messageUUIDs = [];
      for (var hi = 0; hi < forkHistory.length; hi++) {
        if (forkHistory[hi].type === "message_uuid") {
          forked.messageUUIDs.push({ uuid: forkHistory[hi].uuid, type: forkHistory[hi].messageType, historyIndex: hi, turnId: forkHistory[hi].turnId || null });
        }
      }
      saveFork(forked, ws);
      if (ws) sm.switchSession(forked.localId, ws, hydrateImageRefs);
      sm.broadcastSessionList();
      return forked;
    } else {
      // Read history from CLI session files
      var cliSess = require("./cli-sessions");
      var history = await cliSess.readCliSessionHistory(resolveSessionHome(session), cwd, result.sessionId);
      revalidate();
      var options = {
        history: history,
        title: forkTitle,
        vendor: session.vendor,
        ownerId: session.ownerId || null,
        userKnowledgeOwnerId: session.userKnowledgeOwnerId || null,
        sessionVisibility: sessionVisibility.normalize(session.sessionVisibility),
        sessionVisibilityExplicit: session.sessionVisibilityExplicit === true,
      };
      var forked;
      if (ws) forked = sm.resumeSession(result.sessionId, options, ws);
      else {
        forked = sm.createSessionRaw(Object.assign({}, options, { cliSessionId: result.sessionId }));
        forked.title = forkTitle;
        forked.history = history;
        saveFork(forked, ws);
        sm.broadcastSessionList();
      }
      if (forked) {
        if (ws) ws._clayActiveSession = forked.localId;
      }
      return forked;
    }
  }
  return { fork: fork, rewind: rewind };
}
module.exports = { attachSessionHistoryActions: attachSessionHistoryActions };
