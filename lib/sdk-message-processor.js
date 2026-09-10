var usersModule = require("./users");
var yoke = require("./yoke");
var backgroundTaskTiming = require("./background-task-timing");
var sessionTitlePolicy = require("./session-title-policy");
var askUserIdentity = require("./ask-user-request-identity");

var OVERLOAD_RETRY_LIMIT = 3;

function attachMessageProcessor(ctx) {
  var sm = ctx.sm;
  var send = ctx.send;
  var slug = ctx.slug;
  var isMate = ctx.isMate;
  var mateDisplayName = ctx.mateDisplayName;
  var pushModule = ctx.pushModule;
  var getNotificationsModule = ctx.getNotificationsModule || function () { return null; };
  var shouldSuppressResponseNotification = ctx.shouldSuppressResponseNotification || function () { return false; };
  var getSDK = ctx.getSDK;
  var adapter = ctx.adapter;
  var cwd = ctx.cwd;
  var onProcessingChanged = ctx.onProcessingChanged;
  var onTurnDone = ctx.onTurnDone;
  var onAutoTitle = ctx.onAutoTitle;
  var opts = ctx.opts;
  var discoverSkillDirs = ctx.discoverSkillDirs;
  var mergeSkills = ctx.mergeSkills;
  var saveImageFile = ctx.saveImageFile;
  var getSessionLinuxUser = ctx.getSessionLinuxUser || function () { return null; };

  function getMateIdForNotification() {
    if (!isMate) return null;
    if (typeof slug === "string" && slug.indexOf("mate-") === 0) {
      return slug.substring(5) || null;
    }
    return null;
  }

  function sendAndRecord(session, obj, clientObj) {
    sm.sendAndRecord(session, obj, clientObj);
  }

  function parseGeneratedImage(parsed) {
    var data = parsed.data || "";
    var mediaType = parsed.mediaType || "image/png";
    var dataUrlMatch = /^data:(image\/[a-z0-9.+-]+);base64,([\s\S]+)$/i.exec(data);
    if (dataUrlMatch) {
      mediaType = dataUrlMatch[1];
      data = dataUrlMatch[2];
    }
    return { mediaType: mediaType, data: data.replace(/\s/g, "") };
  }

  function sendToSession(session, obj) {
    sm.sendToSession(session, obj);
  }

  // Emit the "not logged in" signal (WS message + notification) so the client
  // auto-opens the login modal. Shared by the Claude path (login-prompt text
  // detection) and the Codex path (app-server unauthorized error). Deduped
  // per session to avoid spamming when multiple auth errors arrive in a burst.
  function emitAuthRequired(session) {
    var now = Date.now();
    if (session._lastAuthEmit && (now - session._lastAuthEmit) < 5000) return;
    session._lastAuthEmit = now;

    var vendor = session.vendor || "claude";

    var authUser = session.ownerId ? usersModule.findUserById(session.ownerId) : null;
    var authLinuxUser = authUser && authUser.linuxUser ? authUser.linuxUser : null;
    var canAutoLogin = !usersModule.isMultiUser()
      || !!authLinuxUser
      || (authUser && authUser.role === "admin");
    var vendorInfo = yoke.getVendorInfo(session.vendor);
    var authTitle = ((vendorInfo && vendorInfo.displayName) || "Claude Code") + " is not logged in.";
    var loginCommand = (vendorInfo && vendorInfo.loginCommand) || "claude login";
    var _nmLogin = getNotificationsModule();
    // Authentication recovery is transient UI state, not transcript content.
    // Recording it makes history replay look like a fresh auth failure and
    // re-opens the login terminal after a successful sign-in.
    sendToSession(session, {
      type: "auth_required",
      text: authTitle,
      vendor: vendor,
      loginCommand: loginCommand,
      linuxUser: authLinuxUser,
      canAutoLogin: canAutoLogin,
    });
    if (_nmLogin) {
      _nmLogin.notify("auth_required", {
        title: authTitle,
        body: "Open a terminal, then click the URL and follow the instructions.",
        slug: slug,
        sessionId: session.localId,
        ownerId: session.ownerId || null,
        vendor: vendor,
        loginCommand: loginCommand,
        linuxUser: authLinuxUser,
        canAutoLogin: canAutoLogin,
      });
    }
    // Reset CLI session so the next query starts fresh with new auth.
    session.cliSessionId = null;
  }

  function getModelsForVendor(vendor) {
    if (vendor && sm.modelsByVendor && sm.modelsByVendor[vendor]) return sm.modelsByVendor[vendor];
    return sm.availableModels || [];
  }

  function toolActivityTextForSubagent(name, input) {
    if (name === "Bash" && input && input.description) return input.description;
    if (name === "Read" && input && input.file_path) return "Reading " + input.file_path.split("/").pop();
    if (name === "Edit" && input && input.file_path) return "Editing " + input.file_path.split("/").pop();
    if (name === "Write" && input && input.file_path) return "Writing " + input.file_path.split("/").pop();
    if (name === "Grep" && input && input.pattern) return "Searching for " + input.pattern;
    if (name === "Glob" && input && input.pattern) return "Finding " + input.pattern;
    if (name === "WebSearch" && input && input.query) return "Searching: " + input.query;
    if (name === "WebFetch") return "Fetching URL...";
    if (name === "Task" && input && input.description) return input.description;
    return "Running " + name + "...";
  }

  function processSubagentMessage(session, parsed) {
    var parentId = parsed.parentToolUseId;
    var content = parsed.content;
    if (!Array.isArray(content)) return;

    if (parsed.messageRole === "assistant") {
      // Extract tool_use blocks from sub-agent assistant messages
      for (var i = 0; i < content.length; i++) {
        var block = content[i];
        if (block.type === "tool_use") {
          var activityText = toolActivityTextForSubagent(block.name, block.input);
          sendAndRecord(session, {
            type: "subagent_tool",
            parentToolId: parentId,
            toolName: block.name,
            toolId: block.id,
            text: activityText,
          });
        } else if (block.type === "thinking") {
          sendAndRecord(session, {
            type: "subagent_activity",
            parentToolId: parentId,
            text: "Thinking...",
          });
        } else if (block.type === "text" && block.text) {
          sendAndRecord(session, {
            type: "subagent_activity",
            parentToolId: parentId,
            text: "Writing response...",
          });
        }
      }
    }
    // user messages with parentToolUseId contain tool_results -- skip silently
  }

  function processSDKMessage(session, parsed) {
    // Timing: log key SDK milestones relative to query start
    if (session._queryStartTs) {
      var _elapsed = Date.now() - session._queryStartTs;
      if (parsed.yokeType === "init") {
        console.log("[PERF] processSDKMessage: system/init +" + _elapsed + "ms");
      }
      if (parsed.yokeType === "turn_start") {
        console.log("[PERF] processSDKMessage: message_start (API response begun) +" + _elapsed + "ms");
      }
      if ((parsed.yokeType === "text_delta" || parsed.yokeType === "tool_input_delta" || parsed.yokeType === "thinking_delta") && !session._firstTextLogged) {
        session._firstTextLogged = true;
        console.log("[PERF] processSDKMessage: FIRST content_block_delta (visible text) +" + _elapsed + "ms");
      }
      if (parsed.yokeType === "result") {
        console.log("[PERF] processSDKMessage: result +" + _elapsed + "ms");
      }
    }

    // Extract session_id from any message that carries it
    if (parsed.sessionId && !session.cliSessionId) {
      session.cliSessionId = parsed.sessionId;
      sm.saveSessionFile(session);
      if (typeof sm.notifySessionIdentityAssigned === "function") {
        sm.notifySessionIdentityAssigned(session.localId);
      }
      sendAndRecord(session, { type: "session_id", cliSessionId: session.cliSessionId });
    } else if (parsed.sessionId) {
      session.cliSessionId = parsed.sessionId;
    }

    // Capture message UUIDs for rewind support
    if (parsed.uuid) {
      if (parsed.messageType === "user" && !parsed.parentToolUseId) {
        session.messageUUIDs.push({ uuid: parsed.uuid, type: "user", historyIndex: session.history.length });
        sendAndRecord(session, { type: "message_uuid", uuid: parsed.uuid, messageType: "user" });
      } else if (parsed.messageType === "assistant") {
        session.messageUUIDs.push({ uuid: parsed.uuid, type: "assistant", historyIndex: session.history.length });
        sendAndRecord(session, { type: "message_uuid", uuid: parsed.uuid, messageType: "assistant" });
      }
    }

    // Cache slash_commands and model from CLI init message
    if (parsed.yokeType === "init") {
      // Ambient housekeeping never drove the sidebar badge, so a reset that
      // only clears ambient watchers must not rebroadcast the session list.
      var previousBackgroundTaskCount = backgroundTaskTiming.countUserTasks(session.activeBackgroundTasks);
      session.activeBackgroundTasks = [];
      sendToSession(session, { type: "active_background_tasks", tasks: [] });
      if (previousBackgroundTaskCount !== 0) sm.broadcastSessionList();
      var fsSkills = discoverSkillDirs();
      sm.skillNames = mergeSkills(parsed.skills, fsSkills);
      if (parsed.slashCommands) {
        // Union: SDK slash_commands + merged skills (deduplicated)
        var seen = new Set();
        var combined = [];
        var all = parsed.slashCommands.concat(Array.from(sm.skillNames));
        for (var k = 0; k < all.length; k++) {
          if (!seen.has(all[k])) {
            seen.add(all[k]);
            combined.push(all[k]);
          }
        }
        sm.slashCommands = combined;
        send({ type: "slash_commands", commands: sm.slashCommands });
      }
      if (parsed.model) {
        var initVendor = session.vendor || (adapter && adapter.vendor) || "claude";
        sm.defaultModelByVendor = sm.defaultModelByVendor || {};
        sm.defaultModelByVendor[initVendor] = sm.defaultModelByVendor[initVendor] || parsed.model;
        var initModels = getModelsForVendor(initVendor);
        var initModel = session.model || sm.defaultModelByVendor[initVendor] || "";
        if (initModels.length > 0 && !initModels.some(function(entry) {
          return entry === initModel || (entry && (entry.value === initModel || entry.id === initModel || entry.resolvedModel === initModel));
        })) initModel = typeof initModels[0] === "string" ? initModels[0] : (initModels[0].value || initModels[0].id || "");
        sendToSession(session, {
          type: "model_info",
          model: initModel,
          models: initModels,
          vendor: initVendor,
          sessionId: session.localId,
          availableVendors: sm.availableVendors || [],
          installedVendors: sm.installedVendors || [],
        });
      }
      if (parsed.fastModeState) {
        sendAndRecord(session, { type: "fast_mode_state", state: parsed.fastModeState });
      }
    }

    if (parsed.yokeType === "turn_start") {
      if (parsed.inputTokens) {
        session.lastStreamInputTokens = parsed.inputTokens;
      }

    } else if (parsed.yokeType === "tool_start" || parsed.yokeType === "thinking_start" || parsed.yokeType === "text_start") {
      var idx = parsed.blockId;

      if (parsed.yokeType === "tool_start") {
        session.blocks[idx] = { type: "tool_use", id: parsed.toolId, name: parsed.toolName, inputJson: "" };
        sendAndRecord(session, { type: "tool_start", id: parsed.toolId, name: parsed.toolName });
      } else if (parsed.yokeType === "thinking_start") {
        session.blocks[idx] = { type: "thinking", thinkingText: "", startTime: Date.now() };
        sendAndRecord(session, { type: "thinking_start" });
      } else if (parsed.yokeType === "text_start") {
        session.blocks[idx] = { type: "text" };
      }

    } else if (parsed.yokeType === "text_delta" || parsed.yokeType === "tool_input_delta" || parsed.yokeType === "thinking_delta") {
      var idx = parsed.blockId;

      if (parsed.yokeType === "text_delta" && typeof parsed.text === "string") {
        session.streamedText = true;
        if (session.responsePreview.length < 200) {
          session.responsePreview += parsed.text;
        }
        // Accumulate text for mate DM response
        if (typeof session._mateDmResponseText === "string") {
          session._mateDmResponseText += parsed.text;
        }
        sendAndRecord(session, { type: "delta", text: parsed.text });
      } else if (parsed.yokeType === "tool_input_delta" && session.blocks[idx]) {
        session.blocks[idx].inputJson += parsed.partialJson;
      } else if (parsed.yokeType === "thinking_delta" && session.blocks[idx]) {
        session.blocks[idx].thinkingText += parsed.text;
        sendAndRecord(session, { type: "thinking_delta", text: parsed.text });
      }

    } else if (parsed.yokeType === "tool_executing") {
      sendAndRecord(session, {
        type: "tool_executing",
        id: parsed.toolId,
        name: parsed.toolName,
        input: parsed.input || {},
      });

    } else if (parsed.yokeType === "tool_result") {
      sendAndRecord(session, {
        type: "tool_result",
        id: parsed.toolId,
        content: parsed.content || "",
        is_error: !!parsed.isError,
      });

    } else if (parsed.yokeType === "generated_image") {
      var generated = parseGeneratedImage(parsed);
      var fileName = null;
      if (!parsed.isError && generated.data && typeof saveImageFile === "function") {
        fileName = saveImageFile(generated.mediaType, generated.data, getSessionLinuxUser(session));
      }
      if (!fileName) {
        sendAndRecord(session, {
          type: "tool_result",
          id: parsed.toolId,
          content: parsed.isError ? "Image generation failed." : "The generated image could not be saved.",
          is_error: true,
        });
      } else {
        sendAndRecord(session, {
          type: "tool_result",
          id: parsed.toolId,
          content: "Image generated",
          is_error: false,
        });
        var imageRef = { mediaType: generated.mediaType, file: fileName };
        var storedImage = {
          type: "generated_image",
          id: parsed.toolId,
          prompt: parsed.prompt || "",
          transparentBackground: parsed.transparentBackground,
          imageRefs: [imageRef],
        };
        var liveImage = {
          type: "generated_image",
          id: parsed.toolId,
          prompt: parsed.prompt || "",
          transparentBackground: parsed.transparentBackground,
          images: [{
            mediaType: generated.mediaType,
            url: "/p/" + slug + "/images/" + fileName,
            fileName: fileName,
          }],
        };
        sendAndRecord(session, storedImage, liveImage);
      }

    } else if (parsed.yokeType === "plan_updated") {
      var todos = Array.isArray(parsed.plan) ? parsed.plan.map(function(step, idx) {
        var todo = {
          id: String(idx + 1),
          content: step.step || "",
          status: step.status || "pending",
        };
        if (todo.status === "in_progress" && parsed.explanation) {
          todo.activeForm = parsed.explanation;
        }
        return todo;
      }) : [];
      sendAndRecord(session, {
        type: "tool_executing",
        id: parsed.turnId || "codex-plan",
        name: "TodoWrite",
        input: {
          todos: todos,
          meta: {
            variant: "plan",
            title: parsed.title || "Plan",
          },
        },
      });

    } else if (parsed.yokeType === "plan_content") {
      sendAndRecord(session, {
        type: "plan_content",
        content: parsed.content || "",
      });

    } else if (parsed.yokeType === "block_stop") {
      var idx = parsed.blockId;
      var block = session.blocks[idx];

      if (block && block.type === "tool_use") {
        var input = {};
        try { input = JSON.parse(block.inputJson); } catch (e) {}
        // Native AskUserQuestion is recorded when canUseTool opens the
        // request. The later block_stop is the SDK's completion notification
        // for that same request, not a second question. Keeping both records
        // made replay render two independently editable cards and allowed the
        // client to submit the same request twice.
        var alreadyRecordedAsk = false;
        if (block.name === "AskUserQuestion" && block.id && Array.isArray(session.history)) {
          for (var ahi = session.history.length - 1; ahi >= 0; ahi--) {
            var priorAsk = session.history[ahi];
            if (askUserIdentity.sameAskUserRequest(priorAsk, block.id, input)) {
              alreadyRecordedAsk = true;
              break;
            }
          }
        }
        if (!alreadyRecordedAsk) {
          sendAndRecord(session, { type: "tool_executing", id: block.id, name: block.name, input: input });
        }

        // Track active Task tools for sub-agent done detection
        if (block.name === "Task") {
          if (!session.activeTaskToolIds) session.activeTaskToolIds = {};
          session.activeTaskToolIds[block.id] = true;
        }

        if (pushModule && block.name === "AskUserQuestion" && input.questions) {
          var q = input.questions[0];
          pushModule.sendPush({
            type: "ask_user",
            slug: slug,
            title: (mateDisplayName || "Claude") + " has a question",
            body: q ? q.question : "Waiting for your response",
            tag: "claude-ask",
          });
        }
      } else if (block && block.type === "thinking") {
        var duration = block.startTime ? (Date.now() - block.startTime) / 1000 : 0;
        sendAndRecord(session, { type: "thinking_stop", duration: duration });
      }

      delete session.blocks[idx];

    } else if (parsed.yokeType === "subagent_message") {
      // Sub-agent messages: extract tool_use blocks for activity display
      processSubagentMessage(session, parsed);

    } else if (parsed.yokeType === "message") {
      var content = parsed.content;

      // Fallback: if assistant text wasn't streamed via deltas, send it now
      if (parsed.messageRole === "assistant" && !session.streamedText && Array.isArray(content)) {
        var assistantText = content
          .filter(function(c) { return c.type === "text"; })
          .map(function(c) { return c.text; })
          .join("");
        if (assistantText) {
          if (session.responsePreview.length < 200) {
            session.responsePreview += assistantText;
          }
          sendAndRecord(session, { type: "delta", text: assistantText });
        }
      }

      // Check for local slash command output in user messages
      if (parsed.messageRole === "user") {
        var fullText = "";
        if (typeof content === "string") {
          fullText = content;
        } else if (Array.isArray(content)) {
          fullText = content
            .filter(function(c) { return c.type === "text"; })
            .map(function(c) { return c.text; })
            .join("\n");
        }
        if (fullText.indexOf("local-command-stdout") !== -1) {
          var m = fullText.match(/<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/);
          if (m) {
            sendAndRecord(session, { type: "slash_command_result", text: m[1].trim() });
          }
        }
      }

      if (Array.isArray(content)) {
        for (var i = 0; i < content.length; i++) {
          var block = content[i];
          if (block.type === "tool_result" && !session.sentToolResults[block.tool_use_id]) {
            // Clear active Task tool when its result arrives
            if (session.activeTaskToolIds && session.activeTaskToolIds[block.tool_use_id]) {
              sendAndRecord(session, {
                type: "subagent_done",
                parentToolId: block.tool_use_id,
              });
              delete session.activeTaskToolIds[block.tool_use_id];
            }
            var resultText = "";
            var resultImages = [];
            if (typeof block.content === "string") {
              resultText = block.content;
            } else if (Array.isArray(block.content)) {
              resultText = block.content
                .filter(function(c) { return c.type === "text"; })
                .map(function(c) { return c.text; })
                .join("\n");
              for (var ri = 0; ri < block.content.length; ri++) {
                var rc = block.content[ri];
                if (rc.type === "image" && rc.source) {
                  resultImages.push({
                    mediaType: rc.source.media_type,
                    data: rc.source.data,
                  });
                }
              }
            }
            session.sentToolResults[block.tool_use_id] = true;
            var toolResultMsg = {
              type: "tool_result",
              id: block.tool_use_id,
              content: resultText,
              is_error: block.is_error || false,
            };
            if (resultImages.length > 0) toolResultMsg.images = resultImages;
            sendAndRecord(session, toolResultMsg);
          }
        }
      }

    } else if (parsed.yokeType === "result") {
      var overloadAbortRequested = !!session._overloadAbortRequested;
      session._overloadAbortRequested = false;
      session.blocks = {};
      session.sentToolResults = {};
      session.pendingPermissions = {};
      session.pendingElicitations = {};
      // Record ask_user_answered for any leftover pending questions so replay pairs correctly.
      // Restored legacy MCP entries survive across turns. Canonical Yoke
      // requests own a live provider callback and are cancelled on turn end.
      var leftoverAskIds = Object.keys(session.pendingAskUser);
      var keptAskUser = {};
      for (var lai = 0; lai < leftoverAskIds.length; lai++) {
        var lid = leftoverAskIds[lai];
        var lentry = session.pendingAskUser[lid];
        if (lentry && lentry.mode === "mcp") {
          keptAskUser[lid] = lentry;
          continue;
        }
        if (lentry && lentry.mode === "yoke" && lentry.respond && typeof lentry.respond.cancel === "function") {
          lentry.respond.cancel("Turn ended");
        }
        sendAndRecord(session, { type: "ask_user_answered", toolId: lid });
      }
      session.pendingAskUser = keptAskUser;
      session.activeTaskToolIds = {};
      session.taskIdMap = {};
      // Only clear rateLimitResetsAt on genuine success (non-zero cost).
      // When rate-limited, the SDK sends result with zero cost right after
      // rate_limit_event; clearing here would prevent auto-continue scheduling.
      if (parsed.cost && parsed.cost > 0) {
        session.rateLimitResetsAt = null;
      }
      console.log("[sdk-bridge] result handler: session " + session.localId + " cost=" + parsed.cost + " rateLimitResetsAt=" + session.rateLimitResetsAt);

      // Handle SDK execution errors: show the error to the user instead of
      // silently swallowing it. These have subtype "error_during_execution".
      if (parsed.subtype === "error_during_execution") {
        var execErrors = parsed.errors || [];
        var execError = execErrors.length > 0
          ? execErrors.join("; ")
          : "Unknown SDK error";
        if (parsed.terminalReason) execError += " (reason: " + parsed.terminalReason + ")";
        console.error("[sdk-bridge] Execution error for session " + session.localId + ": " + execError);
        session.isProcessing = false;
        session._awaitingTurnResult = false;
        session._queuedTurnCount = 0;
        onProcessingChanged();
        if (!overloadAbortRequested) {
          sendAndRecord(session, { type: "error", text: "Claude error: " + execError });
        }
        sendAndRecord(session, { type: "done", code: 1 });
        sm.broadcastSessionList();
        return;
      }

      session._lastAdapterError = null;
      var hasQueuedTurn = (session._queuedTurnCount || 0) > 0;
      if (hasQueuedTurn) {
        session._queuedTurnCount--;
        session._awaitingTurnResult = true;
      } else {
        session.isProcessing = false;
        session._awaitingTurnResult = false;
        session._queuedTurnCount = 0;
        onProcessingChanged();
      }
      // Detect "Not logged in" scenario early for the check below
      var previewTrimmed = (session.responsePreview || "").trim();
      var isZeroCost = !parsed.cost || parsed.cost === 0;
      var isLoginPrompt = isZeroCost && previewTrimmed.length < 100
        && /not logged in/i.test(previewTrimmed) && /\/login/i.test(previewTrimmed);
      // Fetch rich context usage breakdown (fire-and-forget, non-blocking)
      if (session.queryInstance && typeof session.queryInstance.getContextUsage === "function") {
        session.queryInstance.getContextUsage().then(function(ctxUsage) {
          session.lastContextUsage = ctxUsage;
          sendToSession(session, { type: "context_usage", data: ctxUsage });
        }).catch(function(e) {
          console.error("[sdk-bridge] getContextUsage failed (non-fatal):", e.message || e);
        });
      }
      var lastStreamInput = session.lastStreamInputTokens || parsed.lastStreamInputTokens || null;
      session.lastStreamInputTokens = null;
      sendAndRecord(session, {
        type: "result",
        cost: parsed.cost,
        duration: parsed.duration,
        usage: parsed.usage || null,
        modelUsage: parsed.modelUsage || null,
        sessionId: parsed.sessionId,
        lastStreamInputTokens: lastStreamInput,
      });
      if (parsed.fastModeState) {
        sendAndRecord(session, { type: "fast_mode_state", state: parsed.fastModeState });
      }
      // Detect "Not logged in / Please run /login" from SDK.
      // This is a short canned response with zero cost, not actual AI output.
      if (isLoginPrompt) {
        emitAuthRequired(session);
      }
      sendAndRecord(session, { type: "done", code: 0 });
      if (hasQueuedTurn) {
        // The adapter immediately continues with the already queued user turn.
        // Restore the client stop state after the previous turn's done event.
        sendToSession(session, { type: "status", status: "processing" });
      }
      var _donePreviewText = (session.responsePreview || "").replace(/\s+/g, " ").trim();
      if (_donePreviewText.length > 140) _donePreviewText = _donePreviewText.substring(0, 140) + "...";
      var _doneTitle = mateDisplayName ? (mateDisplayName + " responded") : (session.title || "Claude");
      var _suppressResponseNotification = false;
      try { _suppressResponseNotification = shouldSuppressResponseNotification(session) === true; } catch (e) {}

      if (pushModule && !session._delegatedBy && !_suppressResponseNotification) {
        pushModule.sendPush({
          type: "done",
          slug: slug,
          title: _doneTitle,
          body: _donePreviewText || "Response ready",
          tag: "claude-done",
        });
      }

      var _nm = getNotificationsModule();
      if (_nm && !session.loop && !session._delegatedBy && !_suppressResponseNotification) {
        _nm.notify("response_done", {
          title: _doneTitle,
          preview: _donePreviewText,
          slug: slug,
          sessionId: session.localId,
          mateId: getMateIdForNotification(),
          ownerId: session.ownerId || null,
        });
      }
      // Reset for next turn in the same query
      session.lastActivityAt = Date.now();
      session.turnCount = (session.turnCount || 0) + 1;
      var donePreview = session.responsePreview || "";
      session.responsePreview = "";
      session.streamedText = false;
      sm.broadcastSessionList();

      // Auto-generate title after N turns (skip if loop or already auto-generated)
      if (session.turnCount === sessionTitlePolicy.generationTurn(isMate)
          && !session.titleAutoGenerated
          && !session.titleManuallySet
          && !session.loop
          && onAutoTitle) {
        try { onAutoTitle(session); } catch (e) {
          console.error("[auto-title] onAutoTitle threw:", e.message || e);
        }
      }

      if (onTurnDone) {
        try { onTurnDone(session, donePreview); } catch (e) {}
      }

    } else if (parsed.yokeType === "status") {
      if (parsed.status === "compacting") {
        sendAndRecord(session, { type: "compacting", active: true });
      } else if (session.compacting) {
        sendAndRecord(session, { type: "compacting", active: false });
      }
      session.compacting = parsed.status === "compacting";

    } else if (parsed.yokeType === "task_started") {
      var parentId = parsed.parentToolId;
      if (parentId) {
        if (!session.taskIdMap) session.taskIdMap = {};
        session.taskIdMap[parentId] = parsed.taskId;
        sendAndRecord(session, {
          type: "task_started",
          parentToolId: parentId,
          taskId: parsed.taskId,
          description: parsed.description || "",
        });
      }

    } else if (parsed.yokeType === "task_progress") {
      var parentId = parsed.parentToolId;
      if (parentId) {
        sendAndRecord(session, {
          type: "task_progress",
          parentToolId: parentId,
          taskId: parsed.taskId,
          usage: parsed.usage || null,
          lastToolName: parsed.lastToolName || null,
          description: parsed.description || "",
          summary: parsed.summary || null,
        });
      }

    } else if (parsed.yokeType === "task_updated") {
      // Live task state patches (status, description, error, backgrounded)
      var taskId = parsed.task_id;
      var patch = parsed.patch || {};
      var parentId = null;
      if (session.taskIdMap) {
        for (var k in session.taskIdMap) {
          if (session.taskIdMap[k] === taskId) { parentId = k; break; }
        }
      }
      if (parentId) {
        sendAndRecord(session, {
          type: "task_updated",
          parentToolId: parentId,
          taskId: taskId,
          patch: patch,
        });
      }

    } else if (parsed.yokeType === "background_tasks_changed") {
      var previousBackgroundTasks = session.activeBackgroundTasks || [];
      // Count user work only: an ambient watcher starting or stopping must not
      // rebroadcast the session list and flicker every client's sidebar badge.
      var previousBackgroundTaskCount = backgroundTaskTiming.countUserTasks(previousBackgroundTasks);
      // Vendors re-send the whole list on every change, so carry each task's
      // first-seen time forward; otherwise the composer's elapsed timer would
      // restart whenever any other task starts or finishes.
      var activeBackgroundTasks = backgroundTaskTiming.mergeStartTimes(
        previousBackgroundTasks,
        Array.isArray(parsed.tasks) ? parsed.tasks : []
      );
      session.activeBackgroundTasks = activeBackgroundTasks;
      sendToSession(session, { type: "active_background_tasks", tasks: activeBackgroundTasks });
      if (previousBackgroundTaskCount !== backgroundTaskTiming.countUserTasks(activeBackgroundTasks)) {
        sm.broadcastSessionList();
      }

    } else if (parsed.yokeType === "tool_progress") {
      // Sub-agent tool_progress: forward as activity update
      var parentId = parsed.parentToolId;
      if (parentId) {
        sendAndRecord(session, {
          type: "subagent_activity",
          parentToolId: parentId,
          text: parsed.text || "",
        });
      }

    } else if (parsed.yokeType === "task_notification") {
      var parentId = parsed.parentToolId;
      if (parentId) {
        sendAndRecord(session, {
          type: "subagent_done",
          parentToolId: parentId,
          status: parsed.status || "completed",
          summary: parsed.summary || "",
          usage: parsed.usage || null,
        });
      }
      if (session.taskIdMap) {
        for (var k in session.taskIdMap) {
          if (session.taskIdMap[k] === parsed.taskId) {
            delete session.taskIdMap[k];
            break;
          }
        }
      }

    } else if (parsed.yokeType === "rate_limit") {
      var info = parsed.rateLimitInfo;
      console.log("[sdk-bridge] rate_limit_event for session " + session.localId + ": status=" + info.status + " resetsAt=" + info.resetsAt + " isUsingOverage=" + info.isUsingOverage + " isProcessing=" + session.isProcessing);

      // Broadcast reset time for top-bar usage link
      if (info.rateLimitType && info.resetsAt) {
        send({
          type: "rate_limit_usage",
          rateLimitType: info.rateLimitType,
          resetsAt: info.resetsAt * 1000,
          status: info.status,
        });
      }

      // Warning/rejection handling (existing behavior)
      if (info.status === "allowed_warning" || info.status === "rejected") {
        sendAndRecord(session, {
          type: "rate_limit",
          status: info.status,
          resetsAt: info.resetsAt ? info.resetsAt * 1000 : null,
          rateLimitType: info.rateLimitType || null,
          utilization: info.utilization || null,
          isUsingOverage: info.isUsingOverage || false,
        });
        // Track rejection for auto-continue / scheduled message support
        if (info.status === "rejected" && info.resetsAt) {
          session.rateLimitResetsAt = info.resetsAt * 1000;

          // Schedule auto-continue immediately on rejection (don't wait for
          // query completion which has timing issues with worker/non-worker paths).
          if (!session.scheduledMessage && !session.destroying) {
            var acEnabled = session.onQueryComplete ||
              (typeof opts.getAutoContinueSetting === "function" && opts.getAutoContinueSetting(session));
            console.log("[sdk-bridge] rate_limit rejected: acEnabled=" + acEnabled + " overage=" + !!info.isUsingOverage + " session=" + session.localId);
            if (acEnabled) {
              session.rateLimitAutoContinuePending = true;
              if (info.isUsingOverage) {
                // Extra usage available: send continue immediately (5s delay for query to finish)
                console.log("[sdk-bridge] Overage available, sending immediate continue for session " + session.localId);
                session.rateLimitResetsAt = null;
                if (typeof opts.scheduleMessage === "function") {
                  opts.scheduleMessage(session, "continue", Date.now());
                }
              } else {
                // No overage: schedule after rate limit resets
                var acResetsAt = session.rateLimitResetsAt;
                session.rateLimitResetsAt = null;
                console.log("[sdk-bridge] Scheduling auto-continue on rate limit rejection for session " + session.localId);
                if (typeof opts.scheduleMessage === "function") {
                  opts.scheduleMessage(session, "continue", acResetsAt);
                }
              }
            }
          }
        }
      }

    } else if (parsed.yokeType === "prompt_suggestion") {
      sendAndRecord(session, {
        type: "prompt_suggestion",
        suggestion: parsed.suggestion || "",
      });

    } else if (parsed.yokeType === "notification") {
      var notifText = parsed.text || "";
      var notifPriority = parsed.priority || "low";
      if (notifText) {
        sendAndRecord(session, {
          type: "sdk_notification",
          key: parsed.key || "",
          text: notifText,
          priority: notifPriority,
          color: parsed.color || null,
          timeoutMs: parsed.timeout_ms || null,
        });
      }

    } else if (parsed.yokeType === "api_retry") {
      // The Claude SDK may otherwise paint one persistent red error for every
      // retry and remain busy for many minutes. Show one transient status, and
      // stop a repeatedly overloaded turn after a small bounded number of
      // attempts so the user regains control and can retry or change models.
      var apiRetryAttempt = parsed.attempt || 1;
      if (parsed.error === "overloaded") {
        if (apiRetryAttempt === 1) {
          session._overloadAbortRequested = false;
          sendToSession(session, {
            type: "system_info",
            text: "The model is overloaded. Retrying briefly...",
          });
        }
        if (apiRetryAttempt >= OVERLOAD_RETRY_LIMIT && !session._overloadAbortRequested) {
          session._overloadAbortRequested = true;
          sendAndRecord(session, {
            type: "error",
            text: "The model remained overloaded after " + apiRetryAttempt +
              " attempts, so this turn was stopped. Try again or choose another model.",
          });
          if (session.abortController && typeof session.abortController.abort === "function") {
            try { session.abortController.abort(); } catch (e) {}
          }
        }
      } else if (apiRetryAttempt === 1) {
        sendToSession(session, { type: "system_info", text: "The model request failed temporarily. Retrying..." });
      }

    } else if (parsed.yokeType === "commands_changed") {
      // Mid-session command list change: rebuild the union with skills (same as
      // init) and push a full replacement to the client.
      var cmdSeen = new Set();
      var cmdCombined = [];
      var cmdAll = (parsed.commandNames || []).concat(Array.from(sm.skillNames || []));
      for (var ci = 0; ci < cmdAll.length; ci++) {
        if (!cmdSeen.has(cmdAll[ci])) {
          cmdSeen.add(cmdAll[ci]);
          cmdCombined.push(cmdAll[ci]);
        }
      }
      sm.slashCommands = cmdCombined;
      send({ type: "slash_commands", commands: sm.slashCommands });

    } else if (parsed.yokeType === "worker_shutting_down") {
      // Surface non-routine teardown reasons; "host_exit" is the normal close.
      if (parsed.reason && parsed.reason !== "host_exit") {
        sendToSession(session, { type: "system_info", text: "Session worker shutting down: " + parsed.reason });
      }

    } else if (parsed.yokeType === "thinking_tokens") {
      // Live thinking-token estimate; ephemeral, do not persist in history.
      sendToSession(session, {
        type: "thinking_tokens",
        estimatedTokens: parsed.estimatedTokens || 0,
        estimatedTokensDelta: parsed.estimatedTokensDelta || 0,
      });

    } else if (parsed.yokeType === "informational") {
      // Leveled informational message from the agent (info/notice/suggestion/warning).
      if (parsed.content) {
        sendAndRecord(session, {
          type: "informational",
          level: parsed.level || "info",
          content: parsed.content,
          toolUseId: parsed.toolUseId || null,
          preventContinuation: !!parsed.preventContinuation,
        });
      }

    } else if (parsed.yokeType === "permission_denied") {
      // A tool call was blocked; surface why.
      sendAndRecord(session, {
        type: "permission_denied",
        toolName: parsed.toolName || "",
        toolUseId: parsed.toolUseId || null,
        agentId: parsed.agentId || null,
        reasonType: parsed.reasonType || null,
        reason: parsed.reason || null,
        message: parsed.message || "",
      });

    } else if (parsed.yokeType === "auth_required") {
      // Vendor adapter signalled the session isn't authenticated (e.g. Codex
      // app-server returned an unauthorized/token-revoked error). Trigger the
      // same login flow as the Claude login-prompt path.
      session.isProcessing = false;
      session._awaitingTurnResult = false;
      session._queuedTurnCount = 0;
      onProcessingChanged();
      emitAuthRequired(session);

    } else if (parsed.yokeType === "error") {
      // Adapters use a neutral error event for turn failures that arrive as
      // protocol messages instead of thrown iterator errors. Remember it so
      // processQueryStream can finish the turn when the iterator closes.
      var adapterErrorText = parsed.text || parsed.message || parsed.error || "Agent runtime error";
      session._lastAdapterError = adapterErrorText;
      var isSessionWriterConflict = /thread-store conflict|already has an active writer/i.test(adapterErrorText);
      if (isSessionWriterConflict) {
        sendAndRecord(session, {
          type: "session_writer_conflict",
          vendor: session.vendor || "codex",
          text: "This Codex session is already open in another Clay or Codex process. Stop the other server or close the other session, then try again.",
        });
      } else {
        sendAndRecord(session, { type: "error", text: adapterErrorText });
      }

    } else if (parsed.yokeType === "model_refusal") {
      // Model declined the request. "fallback" => the CLI retried on another
      // model; "no_fallback" => the turn ended with a refusal.
      sendAndRecord(session, {
        type: "model_refusal",
        refusalKind: parsed.refusalKind || "no_fallback",
        originalModel: parsed.originalModel || null,
        fallbackModel: parsed.fallbackModel || null,
        direction: parsed.direction || null,
        category: parsed.category || null,
        explanation: parsed.explanation || null,
        content: parsed.content || null,
      });

    } else if (parsed.yokeType === "system") {
      // Catch-all for unhandled system subtypes (e.g. hook-block errors).
      // Extract any error text and surface it in the UI.
      var sysText = parsed.error || parsed.message || parsed.text || "";
      if (!sysText && Array.isArray(parsed.content)) {
        sysText = parsed.content
          .filter(function(c) { return c.type === "text"; })
          .map(function(c) { return c.text; })
          .join("\n");
      }
      if (sysText) {
        console.log("[sdk-bridge] Unhandled system message (subtype=" + (parsed.subtype || "none") + "): " + sysText.substring(0, 200));
        sendAndRecord(session, { type: "error", text: sysText });
      }
    }
  }

  return {
    processSDKMessage: processSDKMessage,
    sendAndRecord: sendAndRecord,
    sendToSession: sendToSession,
    processSubagentMessage: processSubagentMessage,
    toolActivityTextForSubagent: toolActivityTextForSubagent,
  };
}

module.exports = { attachMessageProcessor: attachMessageProcessor };
