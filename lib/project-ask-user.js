var userInput = require("./yoke/user-input");
var askUserIdentity = require("./ask-user-request-identity");

function attachAskUser(ctx) {
  function isFirstDebateQuestion(session) {
    var history = session && Array.isArray(session.history) ? session.history : [];
    for (var i = 0; i < history.length; i++) {
      if (history[i] && history[i].type === "tool_executing" && history[i].name === "AskUserQuestion") return false;
    }
    return !!(session && session.homeDebatePlanning === true);
  }

  function planningQuestions(session, questions) {
    if (!isFirstDebateQuestion(session)) return questions;
    var first = questions[0] || {};
    return [Object.assign({}, first, { multiSelect: false, options: [] })];
  }

  function handleRequest(boundSession, request, respond) {
    if (!boundSession) {
      respond.cancel("This question is not bound to an active session.");
      return;
    }
    if (boundSession.loop && boundSession.loop.active && boundSession.loop.role !== "crafting") {
      respond.cancel("Autonomous mode. Make your own decision.");
      return;
    }
    var questions = ["mcp-import", "product-control"].indexOf(request.source) >= 0 ? request.questions : planningQuestions(boundSession, request.questions);
    var input = { questions: questions };
    if (request.source === 'mcp-import') input.source = 'mcp-import';
    if (!boundSession.pendingAskUser) boundSession.pendingAskUser = {};
    var pending = {
      input: input,
      mode: "yoke",
      request: request,
      respond: respond,
      sessionId: boundSession.localId,
      postedAt: Date.now(),
    };
    boundSession.pendingAskUser[request.id] = pending;
    if (respond && typeof respond.onSettle === "function") {
      respond.onSettle(function (result) {
        if (request.source === 'product-control' && result.status !== 'submitted') ctx.record(boundSession, { type: 'product_control_question_expired', toolId: request.id, error: 'This exact change review expired or was cancelled. No change was authorized.' });
        if (request.source === 'mate-schedule' && result.status !== 'submitted') ctx.record(boundSession, { type: 'mate_schedule_question_expired', toolId: request.id, error: 'This schedule review expired. Request a new review.' });
        if (request.source === 'mcp-import' && result.status !== 'submitted') ctx.record(boundSession, { type: 'mcp_import_consent_expired', toolId: request.id, source: 'mcp-import', error: 'Import consent expired or was cancelled. No connection was imported.' });
        if (boundSession.pendingAskUser && boundSession.pendingAskUser[request.id] === pending) delete boundSession.pendingAskUser[request.id];
      });
    }
    if (!askUserIdentity.hasRecordedAskUserRequest(boundSession.history, request.id, input)) {
      ctx.record(boundSession, { type: "tool_executing", id: request.id, name: "AskUserQuestion", input: input, source: request.source });
    }
    var router = ctx.getWorkerQuestionRouter && ctx.getWorkerQuestionRouter();
    if (router && request.source !== "mcp-import" && request.source !== "mate-schedule" && request.source !== "product-control") router.routeQuestion(boundSession, request, respond, function (answers, driverId) {
      var displayAnswers = {};
      request.questions.forEach(function (question, index) { displayAnswers[index] = answers[question.id].join(", "); });
      ctx.record(boundSession, { type: "ask_user_answered", toolId: request.id, answers: displayAnswers, answeredByDriver: driverId });
    });
  }

  function createHandler(boundSession) {
    return function (request, respond) { handleRequest(boundSession, request, respond); };
  }

  function createMcpServer(adapter, boundSession) {
    return userInput.createFallbackServer(adapter, createHandler(boundSession), {
      force: !!(boundSession && boundSession.debateSetupMode),
    });
  }

  return {
    createHandler: createHandler,
    createMcpServer: createMcpServer,
    getToolDefs: function (boundSession) { return userInput.fallbackToolDefs(createHandler(boundSession)); },
  };
}

module.exports = { attachAskUser: attachAskUser };
