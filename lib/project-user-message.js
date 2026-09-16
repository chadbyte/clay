var path = require("path");
var fs = require("fs");

/**
 * Attach user-message handler and remaining small handlers
 * (sticky notes, terminals, context sources, browser extension,
 *  scheduled tasks gate, loop delegation, schedule_message,
 *  and the main "message" dispatch) to a project context.
 *
 * ctx fields:
 *   cwd, slug, isMate, osUsers,
 *   sm, sdk, nm, tm,
 *   send, sendTo, sendToSession, sendToSessionOthers,
 *   clients, opts,
 *   usersModule, matesModule,
 *   getSessionForWs, getLinuxUserForSession, ensureProjectAccessForSession, getOsUserInfoForWs,
 *   hydrateImageRefs, saveImageFile, imagesDir,
 *   onProcessingChanged, onSessionDone,
 *   _loop              - { handleLoopMessage: fn(ws, msg) }
 *   browserState       - { _browserTabList, _extensionWs, pendingExtensionRequests } (mutable refs)
 *   sendExtensionCommandAny, requestTabContext,
 *   startFileWatch, stopFileWatch,
 *   scheduleMessage, cancelScheduledMessage,
 *   pendingMessageQueue,
 *   loadContextSources, saveContextSources,
 *   digestDmTurn, gateMemory,
 *   adapter            - YOKE adapter instance
 */
function attachUserMessage(ctx) {
  var cwd = ctx.cwd;
  var slug = ctx.slug;
  var isMate = ctx.isMate;
  var osUsers = ctx.osUsers;

  var sm = ctx.sm;
  var sdk = ctx.sdk;
  var nm = ctx.nm;
  var notesLifecycle = require("./notes-lifecycle");
  var createProjectMessageDelivery = require("./project-message-delivery").createProjectMessageDelivery;
  var tm = ctx.tm;

  var send = ctx.send;
  var sendTo = ctx.sendTo;
  var sendToSession = ctx.sendToSession;
  var sendToSessionOthers = ctx.sendToSessionOthers;
  var messageDelivery = createProjectMessageDelivery(sendTo, slug);

  var clients = ctx.clients;
  var opts = ctx.opts;

  var usersModule = ctx.usersModule;
  var matesModule = ctx.matesModule;

  var getSessionForWs = ctx.getSessionForWs;
  var getLinuxUserForSession = ctx.getLinuxUserForSession;
  var ensureProjectAccessForSession = ctx.ensureProjectAccessForSession;
  var getOsUserInfoForWs = ctx.getOsUserInfoForWs;

  var hydrateImageRefs = ctx.hydrateImageRefs;
  var saveImageFile = ctx.saveImageFile;
  var imagesDir = ctx.imagesDir;

  var onProcessingChanged = ctx.onProcessingChanged;
  var gitAttribution = ctx.gitAttribution;

  var _loop = ctx._loop;
  var browserState = ctx.browserState;

  var sendExtensionCommandAny = ctx.sendExtensionCommandAny;
  var requestTabContext = ctx.requestTabContext;

  var scheduleMessage = ctx.scheduleMessage;
  var cancelScheduledMessage = ctx.cancelScheduledMessage;
  var sendScheduledMessageNow = ctx.sendScheduledMessageNow;
  var pendingMessageQueue = ctx.pendingMessageQueue;

  var loadContextSources = ctx.loadContextSources;
  var saveContextSources = ctx.saveContextSources;

  var adapter = ctx.adapter;
  var _email = ctx._email;

  // --------------- Sticky notes ---------------

  function syncNotesKnowledge() {
    if (!isMate) return;
    try {
      var knDir = path.join(cwd, "knowledge");
      var knFile = path.join(knDir, "sticky-notes.md");
      var text = nm.getActiveNotesText();
      if (text) {
        fs.mkdirSync(knDir, { recursive: true });
        fs.writeFileSync(knFile, text);
      } else {
        try { fs.unlinkSync(knFile); } catch (e) {}
      }
    } catch (e) {
      console.error("[project] Failed to sync sticky-notes.md:", e.message);
    }
  }

  // --------------- Main handler ---------------

  function handleUserMessage(ws, msg, forcedSession, internal) {
    if (msg.type === "pending_message_get" || msg.type === "pending_message_edit" || msg.type === "pending_message_cancel" || msg.type === "pending_message_reorder" || msg.type === "pending_message_resume") {
      var queueSession = forcedSession || getSessionForWs(ws);
      if (!queueSession || !pendingMessageQueue) return true;
      var queueActor = ws && ws._clayUser;
      var queueResult;
      if (msg.projectSlug !== slug) queueResult = { ok: false, error: "Project changed", sessionId: queueSession.localId, projectSlug: slug };
      else if (msg.type === "pending_message_resume") {
        queueResult = pendingMessageQueue.resume(queueSession, queueActor, msg.revision, msg.sessionId);
        if (queueResult.ok && !queueResult.paused) {
          queueSession._pendingMessageDrainPaused = false;
          setImmediate(function () { consumePendingMessage(queueSession); });
        }
      }
      else if (msg.type === "pending_message_get") queueResult = pendingMessageQueue.hydrate(queueSession, queueActor);
      else if (msg.type === "pending_message_edit") queueResult = pendingMessageQueue.edit(queueSession, queueActor, msg.id, msg.revision, msg.sessionId, msg.message || {});
      else if (msg.type === "pending_message_cancel") queueResult = pendingMessageQueue.cancel(queueSession, queueActor, msg.id, msg.revision, msg.sessionId);
      else queueResult = pendingMessageQueue.reorder(queueSession, queueActor, msg.ids || [], msg.revision, msg.sessionId);
      sendTo(ws, { type: "pending_message_result", requestId: msg.requestId || null, result: queueResult });
      return true;
    }
    // --- Sticky notes ---
    if (msg.type === "note_create") {
      var note = nm.create(msg);
      if (note) {
        send({ type: "note_created", note: note });
        syncNotesKnowledge();
      }
      return true;
    }

    if (msg.type === "note_update") {
      if (!msg.id) return true;
      // A legacy `hidden` update is a lifecycle transition, so the actor is
      // derived from the bound socket rather than taken from the message.
      var noteChanges = msg;
      if (msg.hidden !== undefined) {
        noteChanges = Object.assign({}, msg, { actor: notesLifecycle.userActor(ws && ws._clayUser) });
      }
      var updated = nm.update(msg.id, noteChanges);
      if (updated) {
        send({ type: "note_updated", note: updated });
        if (msg.text !== undefined || msg.hidden !== undefined) syncNotesKnowledge();
      }
      return true;
    }

    // Completing a note closes it. `note_delete` is the retired spelling and is
    // deliberately routed to the same non-destructive close, so an older client
    // still on the wire cannot erase a record.
    if (msg.type === "note_close" || msg.type === "note_delete") {
      if (!msg.id) return true;
      var closed = nm.close(msg.id, notesLifecycle.userActor(ws && ws._clayUser));
      if (closed) {
        send({ type: "note_updated", note: closed });
        syncNotesKnowledge();
      }
      return true;
    }

    if (msg.type === "note_reopen") {
      if (!msg.id) return true;
      var reopened = nm.reopen(msg.id);
      if (reopened) {
        send({ type: "note_updated", note: reopened });
        syncNotesKnowledge();
      }
      return true;
    }

    if (msg.type === "note_list_request") {
      sendTo(ws, { type: "notes_list", notes: nm.list() });
      return true;
    }

    if (msg.type === "note_bring_front") {
      if (!msg.id) return true;
      var front = nm.bringToFront(msg.id);
      if (front) send({ type: "note_updated", note: front });
      return true;
    }

    // --- Web terminal ---
    if (msg.type === "term_create") {
      if (ws._clayUser) {
        var termPerms = usersModule.getEffectivePermissions(ws._clayUser, osUsers);
        if (!termPerms.terminal) {
          sendTo(ws, { type: "term_error", error: "Terminal access is not permitted" });
          return true;
        }
      }
      var t = tm.create(msg.cols || 80, msg.rows || 24, getOsUserInfoForWs(ws), ws,
        msg.initialCommand ? { initialInput: String(msg.initialCommand) } : undefined);
      if (!t) {
        sendTo(ws, { type: "term_error", error: "Cannot create terminal (node-pty not available or limit reached)" });
        return true;
      }
      tm.attach(t.id, ws);
      send({ type: "term_list", terminals: tm.list() });
      sendTo(ws, { type: "term_created", id: t.id });
      return true;
    }

    if (msg.type === "term_attach") {
      if (msg.id) tm.attach(msg.id, ws);
      return true;
    }

    if (msg.type === "term_detach") {
      if (msg.id) tm.detach(msg.id, ws);
      return true;
    }

    if (msg.type === "term_input") {
      if (msg.id) tm.write(msg.id, msg.data);
      return true;
    }

    if (msg.type === "term_resize") {
      if (msg.id && msg.cols > 0 && msg.rows > 0) {
        tm.resize(msg.id, msg.cols, msg.rows, ws);
      }
      return true;
    }

    if (msg.type === "term_close") {
      if (msg.id) {
        tm.close(msg.id);
        send({ type: "term_list", terminals: tm.list() });
        // Remove closed terminal from context sources
        var _termSessionId = ws._clayActiveSession || null;
        var saved = loadContextSources(slug, _termSessionId);
        var termKey = "term:" + msg.id;
        var filtered = saved.filter(function(id) { return id !== termKey; });
        if (filtered.length !== saved.length) {
          saveContextSources(slug, _termSessionId, filtered);
          send({ type: "context_sources_state", active: filtered });
        }
      }
      return true;
    }

    if (msg.type === "term_rename") {
      if (msg.id && msg.title) {
        tm.rename(msg.id, msg.title);
        send({ type: "term_list", terminals: tm.list() });
      }
      return true;
    }

    // --- Context Sources ---
    if (msg.type === "context_sources_save") {
      var activeIds = msg.active || [];
      var _saveSessionId = ws._clayActiveSession || null;
      saveContextSources(slug, _saveSessionId, activeIds);
      return true;
    }

    // --- Browser Extension ---
    if (msg.type === "browser_tab_list") {
      browserState._extensionWs = ws; // Track which client has the extension
      if (msg.extensionId) browserState._extensionId = msg.extensionId;
      var tabs = msg.tabs || [];
      browserState._browserTabList = {};
      for (var bti = 0; bti < tabs.length; bti++) {
        browserState._browserTabList[tabs[bti].id] = tabs[bti];
      }
      return true;
    }

    if (msg.type === "extension_result") {
      var pending = browserState.pendingExtensionRequests[msg.requestId];
      if (pending) {
        clearTimeout(pending.timer);
        pending.resolve(msg.result);
        delete browserState.pendingExtensionRequests[msg.requestId];
      }
      return true;
    }

    // --- Scheduled tasks permission gate ---
    if (msg.type === "loop_start" || msg.type === "loop_stop" || msg.type === "loop_registry_files" ||
        msg.type === "loop_registry_save_files" || msg.type === "loop_registry_list" ||
        msg.type === "loop_registry_update" || msg.type === "loop_registry_rename" ||
        msg.type === "loop_registry_remove" || msg.type === "loop_registry_convert" ||
        msg.type === "loop_registry_toggle" || msg.type === "loop_registry_rerun" ||
        msg.type === "schedule_create" || msg.type === "schedule_move") {
      if (ws._clayUser) {
        var schPerms = usersModule.getEffectivePermissions(ws._clayUser, osUsers);
        if (!schPerms.scheduledTasks) {
          sendTo(ws, { type: "error", text: "Scheduled tasks access is not permitted" });
          return true;
        }
      }
    }

    // --- Loop message delegation (project-loop.js) ---
    if (_loop.handleLoopMessage(ws, msg)) return true;

    // --- Schedule message for after rate limit resets ---
    if (msg.type === "schedule_message") {
      var schedSession = getSessionForWs(ws);
      var transportAccountId = (ws && ws._clayUser && ws._clayUser.id) ? String(ws._clayUser.id) : "default";
      if (!schedSession || msg.projectSlug !== slug || String(msg.sessionId) !== String(schedSession && schedSession.localId) ||
          (msg.accountId || "default") !== transportAccountId) {
        if (msg.requestId) sendTo(ws, { type: "schedule_message_result", requestId: msg.requestId,
          projectSlug: msg.projectSlug || slug, sessionId: msg.sessionId == null ? null : msg.sessionId,
          accountId: transportAccountId, ok: false, error: "The scheduling session or account is stale.", scheduledMessage: null });
        return true;
      }
      scheduleMessage(schedSession, msg.text || "", msg.resetsAt, ws._clayUser || null, ws,
        { images: msg.images, pastes: msg.pastes }, msg.requestId || null, transportAccountId);
      return true;
    }

    if (msg.type === "cancel_scheduled_message") {
      var cancelSession = getSessionForWs(ws);
      if (!cancelSession) return true;
      if (msg.projectSlug && msg.projectSlug !== slug) return true;
      if (msg.sessionId != null && String(msg.sessionId) !== String(cancelSession.localId)) return true;
      cancelScheduledMessage(cancelSession, ws._clayUser || null, ws, { jobId: msg.jobId, revision: msg.revision, queueRevision: msg.queueRevision, requestId: msg.requestId });
      return true;
    }

    if (msg.type === "send_scheduled_now") {
      var nowSession = getSessionForWs(ws);
      var requestedContext = { projectSlug: slug, sessionId: nowSession ? nowSession.localId : msg.sessionId, revision: pendingMessageQueue ? pendingMessageQueue.getRevision() : 0, items: [], paused: false };
      var controlResult;
      if (!nowSession) controlResult = Object.assign({}, requestedContext, { ok: false, error: "The session is no longer available." });
      else if (msg.projectSlug && msg.projectSlug !== slug) controlResult = Object.assign({}, requestedContext, { ok: false, error: "Project changed" });
      else if (msg.sessionId != null && String(msg.sessionId) !== String(nowSession.localId)) controlResult = Object.assign({}, requestedContext, { ok: false, error: "Session changed" });
      else if (!nowSession.scheduledMessage) controlResult = Object.assign({}, requestedContext, { ok: false, error: "The scheduled message is no longer available." });
      else {
        var sentNow = sendScheduledMessageNow(nowSession, ws._clayUser || null, ws, { jobId: msg.jobId, revision: msg.revision, queueRevision: msg.queueRevision, requestId: msg.requestId });
        controlResult = pendingMessageQueue ? pendingMessageQueue.hydrate(nowSession, ws._clayUser || null) : { ok: sentNow === true, projectSlug: slug, sessionId: nowSession.localId, revision: 0, items: [], paused: false };
        if (sentNow !== true) controlResult = Object.assign({}, controlResult, { ok: false, error: "Could not send the scheduled message." });
      }
      if (msg.requestId) sendTo(ws, { type: "pending_message_result", requestId: msg.requestId, result: controlResult });
      return true;
    }

    if (msg.type !== "message") return false;
    if (!msg.text && (!msg.images || msg.images.length === 0) && (!msg.pastes || msg.pastes.length === 0)) return true;

    var session = forcedSession || getSessionForWs(ws);
    if (!session) return true;
    var pendingInternal = internal && internal.pendingConsumed ? internal : null;
    function finishPendingEarly(outcome, reason) {
      if (pendingInternal && typeof pendingInternal.complete === "function") pendingInternal.complete(outcome, reason);
    }

    if (session.loopInterviewHandoff && session.loopInterviewHandoff.state === "starting") {
      sendTo(ws, { type: "error", text: "Wait for the approved Loop handoff to finish." });
      finishPendingEarly("release", "Loop handoff is still starting");
      return true;
    }

    var queuedReplay = pendingMessageQueue && pendingMessageQueue.inspect(session, ws && ws._clayUser, msg.clientMessageId);
    if (!pendingInternal && queuedReplay) {
      messageDelivery.acknowledge(ws, { clientMessageId: queuedReplay.clientMessageId }, null, session);
      sendTo(ws, { type: "message_queued", clientMessageId: queuedReplay.clientMessageId, sessionId: session.localId, projectSlug: slug, state: queuedReplay.state, paused: pendingMessageQueue.isPaused(session), revision: pendingMessageQueue.getRevision() });
      return true;
    }
    var deliveryReceipt = messageDelivery.inspect(ws, session, msg);
    if (deliveryReceipt.duplicate) {
      messageDelivery.acknowledge(ws, deliveryReceipt, hydrateImageRefs(deliveryReceipt.recordedMessage), session);
      finishPendingEarly(true);
      return true;
    }

    // A configured Split Worker is Driver-operated: its work arrives through
    // the Driver's delegation, not from a person typing into its pane. The UI
    // hides the composer, but the refusal has to live here too — a legacy
    // client, a replayed frame or a hand-crafted message must not be able to
    // inject a human turn into it. The role comes from exact live pair state,
    // never from the payload, and this is the ordinary-message path only:
    // delegated Driver messages, Driver permission decisions, tool traffic and
    // the user's stop/close controls all travel other paths and are untouched.
    if (typeof ctx.isDriverOperatedSession === "function" && ctx.isDriverOperatedSession(session)) {
      sendTo(ws, {
        type: "error",
        text: "This Split Worker is controlled by its Driver. Send the instruction to the Driver session instead.",
      });
      finishPendingEarly(false, "Pending messages cannot be delivered to a Driver-operated Split Worker");
      return true;
    }
    if (!pendingInternal && pendingMessageQueue && (pendingMessageQueue.hasActive(session) || session.isProcessing || session._queryStarting || session._awaitingTurnResult)) {
      var queuedResult = pendingMessageQueue.admit(session, msg, ws && ws._clayUser);
      if (queuedResult.ok) {
        messageDelivery.acknowledge(ws, deliveryReceipt, null, session);
        sendTo(ws, { type: "message_queued", clientMessageId: msg.clientMessageId || null, sessionId: session.localId, projectSlug: slug, state: "pending", paused: pendingMessageQueue.isPaused(session), revision: pendingMessageQueue.getRevision() });
      } else {
        sendTo(ws, { type: "error", text: queuedResult.error || "Unable to queue message" });
      }
      return true;
    }
    if (!pendingInternal) session._pendingMessageDrainPaused = false;
    if (msg.autonomousRunToken) {
      if (!ctx.autonomousRun || !ctx.autonomousRun.consume(session, msg)) {
        sendTo(ws, { type: "error", text: "This Until complete submission is stale or no longer armed." });
        finishPendingEarly(false, "Until complete submission is stale or no longer armed");
        return true;
      }
    } else if (session.autonomousRun && session.autonomousRun.state === "armed") {
      sendTo(ws, { type: "error", text: "Until complete is still being armed. Wait for its acknowledgement before sending." });
      finishPendingEarly("release", "Until complete is still being armed");
      return true;
    } else if (ctx.autonomousRun) {
      ctx.autonomousRun.onHumanMessage(session, msg);
    }
    var autonomousDeliveryMeta = session.autonomousRun && ["running", "reviewing", "waiting-worker", "waiting-user"].indexOf(session.autonomousRun.state) !== -1
      ? { autonomousRunId: session.autonomousRun.id } : undefined;
    if (!pendingInternal && typeof ctx.beginHumanPairTurn === "function") ctx.beginHumanPairTurn(session);
    if (!pendingInternal && gitAttribution) gitAttribution.beginTurn(session);

    // Bind vendor to session on first message (if not already set)
    if (!session.vendor && msg.vendor) {
      session.vendor = msg.vendor;
      sm.saveSessionFile(session);
      sm.broadcastSessionList();
    }

    // Backfill ownerId for legacy sessions restored without one (multi-user only)
    if (!session.ownerId && ws._clayUser && usersModule.isMultiUser()) {
      session.ownerId = ws._clayUser.id;
      sm.saveSessionFile(session);
    }

    // Keep any pending scheduled message alive when user sends a regular message

    var userMsg2 = { type: "user_message", text: msg.text || "", projectSlug: slug, sessionId: session.localId };
    // Attach sender info for multi-user attribution (backward-compatible: old clients ignore these)
    if (ws._clayUser) {
      userMsg2.from = ws._clayUser.id;
      userMsg2.fromName = ws._clayUser.displayName || ws._clayUser.username || "";
    }
    var savedImagePaths = [];
    if (msg.images && msg.images.length > 0) {
      userMsg2.imageCount = msg.images.length;
      // Save images as files, store URL references in history
      var imageRefs = [];
      for (var imgIdx = 0; imgIdx < msg.images.length; imgIdx++) {
        var img = msg.images[imgIdx];
        var savedName = saveImageFile(img.mediaType, img.data, getLinuxUserForSession(session));
        if (savedName) {
          imageRefs.push({ mediaType: img.mediaType, file: savedName });
          savedImagePaths.push(path.join(imagesDir, savedName));
        }
      }
      if (imageRefs.length > 0) {
        userMsg2.imageRefs = imageRefs;
      }
    }
    if (msg.pastes && msg.pastes.length > 0) {
      userMsg2.pastes = msg.pastes;
    }
    if (deliveryReceipt.clientMessageId) userMsg2.clientMessageId = deliveryReceipt.clientMessageId;
    if (!userMsg2._ts) userMsg2._ts = Date.now();
    var transcriptRecorded = false;
    var pendingContextPreviews = [];
    function recordTranscript() {
      if (transcriptRecorded) return;
      transcriptRecorded = true;
      if (pendingInternal && typeof ctx.beginHumanPairTurn === "function") ctx.beginHumanPairTurn(session);
      if (pendingInternal && gitAttribution) gitAttribution.beginTurn(session);
      session.history.push(userMsg2);
      sm.appendToSessionFile(session, userMsg2);
      messageDelivery.markRecorded(session, deliveryReceipt, userMsg2);
      if (!pendingInternal) messageDelivery.acknowledge(ws, deliveryReceipt, hydrateImageRefs(userMsg2), session);
      sendToSessionOthers(pendingInternal ? null : ws, session.localId, hydrateImageRefs(userMsg2));
      for (var previewIndex = 0; previewIndex < pendingContextPreviews.length; previewIndex++) recordContextPreview(pendingContextPreviews[previewIndex]);
      recordSessionTitle();
    }
    if (!pendingInternal) recordTranscript();

    function recordSessionTitle() {
      if (!session.title) {
        session.title = (msg.text || "Image").substring(0, 50);
        // This title is an optimistic first-message label, not a semantic or
        // explicit title. Persist its provenance so startQuery can preserve
        // eligibility for model generation after this function returns.
        session.titleProvisional = true;
        sm.saveSessionFile(session);
        sm.broadcastSessionList();
        // Sync auto-title to SDK
        if (session.cliSessionId) {
          adapter.renameSession(session.cliSessionId, session.title, { dir: cwd }).catch(function(e) {
            console.error("[project] SDK renameSession failed:", e.message);
          });
        }
      }
    }

    function recordContextPreview(previewEntry) {
      session.history.push(previewEntry);
      sendToSession(session.localId, {
        type: "context_preview",
        tab: {
          title: previewEntry.tab.title,
          url: previewEntry.tab.url,
          favIconUrl: previewEntry.tab.favIconUrl,
          screenshotUrl: "/p/" + slug + "/images/" + previewEntry.tab.screenshotFile,
        },
      });
      sm.saveSessionFile(session);
    }

    var fullText = msg.text || "";
    // Prepend saved image paths so Claude can copy/save them
    if (savedImagePaths.length > 0) {
      var imgPathLines = savedImagePaths.map(function (p) { return "[Uploaded image: " + p + "]"; }).join("\n");
      fullText = imgPathLines + (fullText ? "\n" + fullText : "");
    }
    if (msg.pastes && msg.pastes.length > 0) {
      for (var pi = 0; pi < msg.pastes.length; pi++) {
        if (fullText) fullText += "\n\n";
        fullText += msg.pastes[pi];
      }
    }

    // Inject pending @mention context so the current agent sees the exchange
    var pendingMentionCount = 0;
    if (session.pendingMentionContexts && session.pendingMentionContexts.length > 0) {
      var mentionPrefix = session.pendingMentionContexts.join("\n\n");
      pendingMentionCount = session.pendingMentionContexts.length;
      if (!pendingInternal) session.pendingMentionContexts = [];
      fullText = mentionPrefix + "\n\n" + fullText;
    }

    // Inject one-shot shell results captured from the composer command mode.
    var pendingShellCount = 0;
    if (session.pendingShellContexts && session.pendingShellContexts.length > 0) {
      var shellPrefix = session.pendingShellContexts.join("\n\n");
      pendingShellCount = session.pendingShellContexts.length;
      if (!pendingInternal) session.pendingShellContexts = [];
      fullText = shellPrefix + "\n\n" + fullText;
    }
    if (msg.shellCommandResponse) {
      fullText += "\n\n[Respond to the shell command result above now.]";
    }

    // Inject active terminal context sources (delta only: send new output since last message)
    var TERM_CONTEXT_MAX = 8192; // 8KB max per terminal per message
    var TERM_HEAD_SIZE = 2048;   // keep first 2KB for error context
    var TERM_TAIL_SIZE = 6144;   // keep last 6KB for recent state
    var ctxSources = loadContextSources(slug, session.localId);
    var pendingTermCursors = {};
    if (ctxSources.length > 0) {
      if (!session._termContextCursors) session._termContextCursors = {};
      var termContextParts = [];
      for (var ci = 0; ci < ctxSources.length; ci++) {
        var srcId = ctxSources[ci];
        if (srcId.startsWith("term:")) {
          var termId = parseInt(srcId.split(":")[1], 10);
          var sb = tm.getScrollback(termId);
          if (sb) {
            var lastCursor;
            if (termId in session._termContextCursors) {
              lastCursor = session._termContextCursors[termId];
              // Terminal was recycled (closed and reopened with same ID) -- reset cursor
              if (lastCursor > sb.totalBytesWritten) lastCursor = 0;
            } else {
              // First time seeing this terminal -- include last 8KB (what user can see now)
              lastCursor = Math.max(0, sb.totalBytesWritten - TERM_CONTEXT_MAX);
            }
            var newBytes = sb.totalBytesWritten - lastCursor;
            if (pendingInternal) pendingTermCursors[termId] = sb.totalBytesWritten;
            else session._termContextCursors[termId] = sb.totalBytesWritten;
            if (newBytes <= 0) continue;
            // Build timestamped delta from chunks
            var deltaChunks = [];
            var bytePos = sb.bufferStart;
            for (var chunkIdx = 0; chunkIdx < sb.chunks.length; chunkIdx++) {
              var chunk = sb.chunks[chunkIdx];
              var chunkEnd = bytePos + chunk.data.length;
              if (chunkEnd > lastCursor) {
                // This chunk has new content
                var chunkData = chunk.data;
                if (bytePos < lastCursor) {
                  // Partial chunk: only the part after lastCursor
                  chunkData = chunkData.slice(lastCursor - bytePos);
                }
                deltaChunks.push({ ts: chunk.ts, data: chunkData });
              }
              bytePos = chunkEnd;
            }
            if (deltaChunks.length === 0) continue;
            // Format with timestamps: group by second to avoid excessive timestamps
            var lines = [];
            var lastTimeSec = 0;
            for (var di = 0; di < deltaChunks.length; di++) {
              var dc = deltaChunks[di];
              var cleaned = dc.data.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
              if (!cleaned) continue;
              var timeSec = Math.floor(dc.ts / 1000);
              if (timeSec !== lastTimeSec) {
                var d = new Date(dc.ts);
                var timeStr = d.toTimeString().slice(0, 8); // HH:MM:SS
                lines.push("[" + timeStr + "] " + cleaned);
                lastTimeSec = timeSec;
              } else {
                lines.push(cleaned);
              }
            }
            var delta = lines.join("").trim();
            if (!delta) continue;
            var termInfo = tm.list().find(function(t) { return t.id === termId; });
            var termTitle = termInfo ? termInfo.title : "Terminal " + termId;
            var header;
            if (delta.length > TERM_CONTEXT_MAX) {
              var head = delta.slice(0, TERM_HEAD_SIZE);
              var tail = delta.slice(-TERM_TAIL_SIZE);
              var omittedBytes = delta.length - TERM_HEAD_SIZE - TERM_TAIL_SIZE;
              var omittedLines = delta.slice(TERM_HEAD_SIZE, delta.length - TERM_TAIL_SIZE).split("\n").length;
              delta = head + "\n\n... (" + omittedLines + " lines / " + Math.round(omittedBytes / 1024) + "KB omitted) ...\n\n" + tail;
              header = "[New terminal output from " + termTitle + " (large output, head+tail shown)]";
            } else {
              header = "[New terminal output from " + termTitle + "]";
            }
            termContextParts.push(header + "\n```\n" + delta + "\n```");
          }
        }
      }
      if (termContextParts.length > 0) {
        fullText = termContextParts.join("\n\n") + "\n\n" + fullText;
      }
    }

    // Collect email context (async: requires IMAP fetch for checked email accounts)
    var emailSources = ctxSources.filter(function(id) { return id.startsWith("email:"); });
    var emailContextPromise;
    if (emailSources.length > 0 && _email) {
      var emailUserId = (ws._clayUser && ws._clayUser.id) || "default";
      emailContextPromise = _email.getEmailContext(emailUserId, session.localId).catch(function () { return ""; });
    } else {
      emailContextPromise = Promise.resolve("");
    }

    // Collect browser tab context (async: requires round-trip to client extension)
    var _browserTabList = browserState._browserTabList;
    var tabSources = ctxSources.filter(function(id) {
      if (!id.startsWith("tab:")) return false;
      // Only include tabs that currently exist in the browser
      var tid = parseInt(id.split(":")[1], 10);
      return !!_browserTabList[tid];
    });

    function pendingBlockReason() {
      if (!pendingInternal) return null;
      if (!pendingMessageQueue.isClaimed(session, pendingInternal.item.id)) return "Pending message was cancelled";
      if (pendingMessageQueue.isPaused(session) || session._pendingMessageDrainPaused || session.taskStopRequested) return "Pending message dispatch paused";
      if (typeof ctx.authorizePendingDispatch !== "function" || !ctx.authorizePendingDispatch(session, ws && ws._clayUser, pendingInternal.item)) return "Pending message authorization changed";
      return null;
    }

    function pendingStillAuthorized() {
      return !pendingBlockReason();
    }

    function acceptPendingDispatch() {
      if (!pendingInternal) return true;
      var blockReason = pendingBlockReason();
      if (blockReason) {
        rejectPendingDispatch(blockReason);
        return false;
      }
      if (pendingMentionCount && Array.isArray(session.pendingMentionContexts)) session.pendingMentionContexts.splice(0, pendingMentionCount);
      if (pendingShellCount && Array.isArray(session.pendingShellContexts)) session.pendingShellContexts.splice(0, pendingShellCount);
      Object.keys(pendingTermCursors).forEach(function (termId) { session._termContextCursors[termId] = pendingTermCursors[termId]; });
      recordTranscript();
      pendingInternal.complete(true);
      return true;
    }

    function rejectPendingDispatch(error) {
      if (!pendingInternal) return;
      var reason = error && error.message ? error.message : error || "Pending message dispatch was rejected";
      if (reason === "Pending message dispatch paused") pendingInternal.complete("release", reason);
      else pendingInternal.complete(false, reason);
    }

    function startFreshQuery(finalText) {
      session._queryStartTs = Date.now();
      console.log("[PERF] project.js: startQuery called, localId=" + session.localId + " t=0ms");
      var started = sdk.startQuery(session, finalText, msg.images, ensureProjectAccessForSession(session), function () {
        var blockReason = pendingBlockReason();
        if (blockReason) rejectPendingDispatch(blockReason);
        return !blockReason;
      }, acceptPendingDispatch);
      if (pendingInternal && started && typeof started.then === "function") started.then(function (accepted) {
        if (accepted === false) rejectPendingDispatch("Pending message dispatch was rejected");
      }).catch(rejectPendingDispatch);
    }

    function dispatchToSdk(finalText) {
      if (!session.isProcessing) {
        session.isProcessing = true;
        onProcessingChanged();
        session.sentToolResults = {};
        sendToSession(session.localId, { type: "status", status: "processing" });
        if (!session.queryInstance && !session._queryStarting && (!session.worker || session.messageQueue !== "worker")) {
          // No active query (or worker idle between queries): start a new query
          startFreshQuery(finalText);
        } else if (!sdk.pushMessage(session, finalText, msg.images, autonomousDeliveryMeta)) {
          // Stale state won the branch (previous stream died between the
          // turn boundary and its cleanup) but there is nothing to deliver
          // to. Start a fresh query with this text instead of dropping it,
          // which used to leave the processing indicator bouncing with no
          // response until the user sent the message again.
          startFreshQuery(finalText);
        } else acceptPendingDispatch();
      } else if (!sdk.pushMessage(session, finalText, msg.images, autonomousDeliveryMeta)) {
        // isProcessing was stuck true with no live query: same recovery.
        startFreshQuery(finalText);
      } else acceptPendingDispatch();
      sm.broadcastSessionList();
    }

    // Wait for email context, then proceed with browser tab context and dispatch
    emailContextPromise.then(function (emailCtxText) {
      var emailBlockReason = pendingBlockReason();
      if (emailBlockReason) { rejectPendingDispatch(emailBlockReason); return; }
      if (emailCtxText) {
        fullText = emailCtxText + "\n\n" + fullText;
      }

    if (tabSources.length > 0) {
      // Request tab context from all active browser tab sources
      var tabPromises = tabSources.map(function(srcId) {
        var tabId = parseInt(srcId.split(":")[1], 10);
        return requestTabContext(tabId);
      });
      Promise.all(tabPromises).then(function(results) {
        var tabBlockReason = pendingBlockReason();
        if (tabBlockReason) { rejectPendingDispatch(tabBlockReason); return; }
        var tabContextParts = [];
        var screenshotImages = [];

        for (var ti = 0; ti < results.length; ti++) {
          if (!results[ti]) continue;
          var tabId2 = parseInt(tabSources[ti].split(":")[1], 10);
          var tabInfo = _browserTabList[tabId2];
          var tabLabel = tabInfo ? (tabInfo.title || tabInfo.url || "Tab " + tabId2) : "Tab " + tabId2;
          var r = results[ti];
          var parts = [];

          // Console logs
          if (r.console && r.console.logs) {
            try {
              var logs = typeof r.console.logs === "string" ? JSON.parse(r.console.logs) : r.console.logs;
              if (logs && logs.length > 0) {
                var logLines = [];
                var logSlice = logs.slice(-50);
                for (var li = 0; li < logSlice.length; li++) {
                  var entry = logSlice[li];
                  var ts = entry.ts ? new Date(entry.ts).toTimeString().slice(0, 8) : "";
                  var lvl = (entry.level || "log").toUpperCase();
                  logLines.push("[" + ts + " " + lvl + "] " + (entry.text || ""));
                }
                parts.push("Console:\n" + logLines.join("\n"));
              }
            } catch (e) {
              // ignore parse errors
            }
          }

          // Network requests
          if (r.network && r.network.network) {
            try {
              var netLog = typeof r.network.network === "string" ? JSON.parse(r.network.network) : r.network.network;
              if (netLog && netLog.length > 0) {
                var netLines = [];
                var netSlice = netLog.slice(-30);
                for (var ni = 0; ni < netSlice.length; ni++) {
                  var req = netSlice[ni];
                  var line = (req.method || "GET") + " " + (req.url || "") + " " + (req.status || 0) + " " + (req.duration || 0) + "ms";
                  if (req.error) line += " [" + req.error + "]";
                  netLines.push(line);
                }
                parts.push("Network (last " + netSlice.length + " requests):\n" + netLines.join("\n"));
              }
            } catch (e) {
              // ignore parse errors
            }
          }

          // Page text (from tab_page_text command)
          if (r.pageText && (r.pageText.text || r.pageText.value)) {
            var pageContent = r.pageText.text || r.pageText.value;
            if (pageContent.length > 0) {
              if (pageContent.length > 32768) {
                pageContent = pageContent.substring(0, 32768) + "\n... (truncated)";
              }
              parts.push("Page text:\n" + pageContent);
            }
          }

          // Screenshot -- save to disk and add to images for SDK
          if (r.screenshot && r.screenshot.image) {
            try {
              var screenshotData = r.screenshot.image;
              var screenshotName = saveImageFile("image/png", screenshotData, getLinuxUserForSession(session));
              if (screenshotName) {
                var screenshotPath = path.join(imagesDir, screenshotName);
                // Add to images array for SDK multimodal
                screenshotImages.push({
                  mediaType: "image/png",
                  data: screenshotData,
                  file: screenshotName,
                  tabTitle: tabLabel,
                  tabUrl: tabInfo ? tabInfo.url : "",
                  tabFavIconUrl: tabInfo ? tabInfo.favIconUrl : ""
                });
                parts.push("[Screenshot saved: " + screenshotPath + "]");
              }
            } catch (e) {
              // ignore screenshot save errors
            }
          }

          if (r.console && r.console.error) {
            parts.push("(Console error: " + r.console.error + ")");
          }
          if (r.network && r.network.error) {
            parts.push("(Network error: " + r.network.error + ")");
          }

          if (parts.length > 0) {
            tabContextParts.push("[Browser tab: " + tabLabel + "]\n" + parts.join("\n\n"));
          }
        }

        if (tabContextParts.length > 0) {
          fullText = "[The following browser tab data is automatically attached as context sources. Do NOT call browser_read_page, browser_console, browser_network, or browser_screenshot for these tabs -- the data is already here.]\n\n" +
            tabContextParts.join("\n\n---\n\n") + "\n\n" + fullText;
        }

        // If screenshots were captured, send context preview cards and add to SDK images
        if (screenshotImages.length > 0) {
          if (!msg.images) msg.images = [];
          for (var si = 0; si < screenshotImages.length; si++) {
            var ss = screenshotImages[si];
            // Save context_preview to history so it restores on session load
            var previewEntry = {
              type: "context_preview",
              tab: {
                title: ss.tabTitle || "",
                url: ss.tabUrl || "",
                favIconUrl: ss.tabFavIconUrl || "",
                screenshotFile: ss.file
              }
            };
            if (pendingInternal) pendingContextPreviews.push(previewEntry);
            else recordContextPreview(previewEntry);
            // Add to SDK images for multimodal
            msg.images.push({ mediaType: ss.mediaType, data: ss.data });
          }
        }

        dispatchToSdk(fullText);
      }).catch(rejectPendingDispatch);
    } else {
      dispatchToSdk(fullText);
    }

    }).catch(rejectPendingDispatch); // emailContextPromise.then

    return true;
  }

  function consumePendingMessage(session) {
    if (!pendingMessageQueue) return false;
    var consumed = pendingMessageQueue.consumeOne(session, function (item, complete) {
      var actor = item.actorId && usersModule.findUserById(item.actorId);
      if ((!actor && item.actorId !== "default") || typeof ctx.authorizePendingDispatch !== "function" || !ctx.authorizePendingDispatch(session, actor || null, item)) {
        complete(false, "Pending message authorization changed");
        return true;
      }
      var source = { _clayUser: actor || null, readyState: 1, send: function () {} };
      handleUserMessage(source, copyMessage(item.message), session, { pendingConsumed: true, item: item, complete: complete });
      return true;
    });
    return !!consumed;
  }

  return {
    handleUserMessage: handleUserMessage,
    consumePendingMessage: consumePendingMessage,
    syncNotesKnowledge: syncNotesKnowledge,
  };
}

function copyMessage(message) {
  return JSON.parse(JSON.stringify(message || {}));
}

module.exports = { attachUserMessage: attachUserMessage };
