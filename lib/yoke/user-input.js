// Provider-neutral structured user-input lifecycle for YOKE queries.

var crypto = require("crypto");
var z;
try { z = require("zod"); } catch (e) { z = null; }

var TOOL_NAME = "ask_user_questions";

function cleanText(value, field, max) {
  if (typeof value !== "string" || !value.trim()) throw new Error(field + " must be a non-empty string.");
  var text = value.trim();
  if (text.length > max) throw new Error(field + " must be at most " + max + " characters.");
  return text;
}

function normalizeOptions(options, questionIndex) {
  if (options == null) return [];
  if (!Array.isArray(options)) throw new Error("Question " + (questionIndex + 1) + " options must be an array.");
  if (options.length === 1 || options.length > 6) {
    throw new Error("Question " + (questionIndex + 1) + " must use zero options or 2-6 options.");
  }
  var result = [];
  for (var i = 0; i < options.length; i++) {
    var option = options[i] || {};
    result.push({
      label: cleanText(option.label || option.value, "Option label", 60),
      description: typeof option.description === "string" ? option.description.trim().substring(0, 160) : "",
    });
  }
  return result;
}

function normalizeQuestions(input) {
  var source = input && Array.isArray(input.questions) ? input.questions : null;
  if (!source || source.length < 1 || source.length > 3) throw new Error("Structured input requires 1-3 questions.");
  var ids = {};
  var questions = [];
  for (var i = 0; i < source.length; i++) {
    var item = source[i] || {};
    var id = typeof item.id === "string" && item.id.trim() ? item.id.trim() : "question_" + (i + 1);
    if (id.length > 128 || ids[id]) throw new Error("Question IDs must be unique strings of at most 128 characters.");
    ids[id] = true;
    questions.push({
      id: id,
      header: typeof item.header === "string" ? item.header.trim().substring(0, 40) : "",
      question: cleanText(item.question || item.prompt, "Question", 2000),
      multiSelect: item.multiSelect === true,
      allowOther: item.allowOther !== false && item.isOther !== false,
      secret: item.secret === true || item.isSecret === true,
      options: normalizeOptions(item.options, i),
    });
  }
  return questions;
}

function questionsFromElicitation(request) {
  var schema = request && request.requestedSchema;
  var properties = schema && schema.properties && typeof schema.properties === "object" ? schema.properties : null;
  var questions = [];
  if (properties) {
    Object.keys(properties).forEach(function (id) {
      var property = properties[id] || {};
      var values = Array.isArray(property.enum) ? property.enum : [];
      questions.push({
        id: id,
        header: request.serverName || "Input",
        question: property.description || request.message || id,
        options: values.map(function (value) { return { label: String(value), description: "" }; }),
      });
    });
  }
  if (!questions.length) questions.push({ id: "response", header: request.serverName || "Input", question: request.message || "What should the tool use?", options: [] });
  return { questions: questions };
}

function answerValues(value) {
  if (value && Array.isArray(value.answers)) value = value.answers;
  if (!Array.isArray(value)) value = value == null ? [] : [value];
  return value.map(function (entry) { return String(entry).trim(); }).filter(Boolean);
}

function normalizeAnswers(questions, raw) {
  raw = raw || {};
  var answers = {};
  for (var i = 0; i < questions.length; i++) {
    var question = questions[i];
    var value = Object.prototype.hasOwnProperty.call(raw, question.id) ? raw[question.id] : raw[i];
    var values = answerValues(value);
    if (!values.length) throw new Error("An answer is required for " + question.id + ".");
    if (!question.multiSelect && values.length > 1) throw new Error("Only one answer is allowed for " + question.id + ".");
    answers[question.id] = values;
  }
  return answers;
}

/**
 * Start one provider-neutral structured-input request.
 *
 * handler receives:
 *   request: { id, questions, source, native, provider, diagnostics }
 *   respond(answers): submits once; respond.cancel(reason) cancels once.
 *
 * The returned promise resolves to { status, answers|reason }. Provider
 * adapters translate that result back to their own wire protocol. Nothing in
 * this lifecycle is persisted; Clay callers may persist sanitized events.
 */
function dispatchUserInput(handler, input, opts) {
  opts = opts || {};
  var questions;
  try { questions = normalizeQuestions(input); } catch (e) { return Promise.reject(e); }
  if (typeof handler !== "function") return Promise.reject(new Error("This query cannot request structured user input."));
  var id = opts.requestId || (input && input.id) || "yoke_input_" + crypto.randomUUID();
  var settled = false;
  var abortHandler = null;
  var settleListeners = [];
  return new Promise(function (resolve, reject) {
    function cleanup(result) {
      if (opts.signal && abortHandler && typeof opts.signal.removeEventListener === "function") opts.signal.removeEventListener("abort", abortHandler);
      for (var li = 0; li < settleListeners.length; li++) {
        try { settleListeners[li](result); } catch (e) {}
      }
    }
    function finish(result) {
      if (settled) return false;
      settled = true;
      cleanup(result);
      resolve(result);
      return true;
    }
    function fail(error) {
      if (settled) return false;
      settled = true;
      cleanup({ status: "error", error: error.message || String(error) });
      reject(error);
      return true;
    }
    var respond = function (answers) {
      try { return finish({ status: "submitted", answers: normalizeAnswers(questions, answers) }); }
      catch (e) { return fail(e); }
    };
    respond.submitContent = function (content) {
      if (!content || typeof content !== "object" || Array.isArray(content)) return fail(new Error("Structured elicitation content must be an object."));
      return finish({ status: "submitted", answers: {}, content: content });
    };
    respond.cancel = function (reason) { return finish({ status: "cancelled", reason: reason || "Cancelled" }); };
    respond.isPending = function () { return !settled; };
    respond.onSettle = function (listener) {
      if (typeof listener === "function" && !settled) settleListeners.push(listener);
      return respond;
    };
    abortHandler = function () { respond.cancel("Aborted"); };
    if (opts.signal) {
      if (opts.signal.aborted) return abortHandler();
      opts.signal.addEventListener("abort", abortHandler, { once: true });
    }
    var request = {
      id: String(id),
      questions: questions,
      presentation: opts.presentation || "questions",
      source: opts.source || "unknown",
      native: opts.native === true,
      provider: opts.provider || null,
      diagnostics: opts.diagnostics || null,
    };
    try {
      var returned = handler(request, respond);
      if (returned && typeof returned.then === "function") returned.catch(fail);
    } catch (error) {
      fail(error);
    }
  });
}

function claudePermissionResult(input, result) {
  if (!result || result.status !== "submitted") return { behavior: "deny", message: (result && result.reason) || "Cancelled" };
  var questions = normalizeQuestions(input);
  var byText = {};
  for (var i = 0; i < questions.length; i++) byText[questions[i].question] = result.answers[questions[i].id].join(", ");
  return { behavior: "allow", updatedInput: Object.assign({}, input, { answers: byText }) };
}

function codexResponse(result) {
  var answers = {};
  if (result && result.status === "submitted") {
    Object.keys(result.answers).forEach(function (id) { answers[id] = { answers: result.answers[id] }; });
  }
  return { answers: answers };
}

function elicitationResponse(result) {
  if (!result || result.status !== "submitted") return { action: "reject" };
  if (result.content) return { action: "accept", content: result.content };
  var content = {};
  Object.keys(result.answers).forEach(function (id) { content[id] = result.answers[id].length === 1 ? result.answers[id][0] : result.answers[id]; });
  return { action: "accept", content: content };
}

function buildQuestionShape(maxQuestions) {
  if (!z) return {};
  var option = z.object({ label: z.string().min(1).max(60), description: z.string().max(160).optional() }).passthrough();
  var question = z.object({
    id: z.string().max(128).optional(), header: z.string().max(40).optional(), question: z.string().min(1),
    multiSelect: z.boolean().optional(), options: z.array(option).max(6).refine(function (items) { return items.length === 0 || items.length >= 2; }),
  }).passthrough();
  return { questions: z.array(question).min(1).max(maxQuestions || 3) };
}

function questionLimit(options) {
  var value = options && options.maxQuestions;
  if (typeof value === "function") value = value();
  return value === 1 ? 1 : null;
}

function fallbackToolDefs(handler, options) {
  options = options || {};
  var initialLimit = questionLimit(options);
  return [{
    name: TOOL_NAME,
    queryBound: true,
    description: initialLimit === 1
      ? "Ask the user exactly one structured question, wait for the answer, then call again if another question is needed. Use zero options for freeform or 2-6 options for choices; never one option."
      : "Ask the user 1-3 structured questions. Use zero options for freeform or 2-6 options for choices; never one option.",
    inputSchema: buildQuestionShape(initialLimit),
    handler: function (input) {
      if (questionLimit(options) === 1 && input && Array.isArray(input.questions) && input.questions.length !== 1) {
        return Promise.resolve({ content: [{ type: "text", text: "Ask exactly one question at a time, wait for the answer, then ask the next question." }], isError: true });
      }
      return dispatchUserInput(handler, input, { source: "mcp_fallback", native: false }).then(function (result) {
        if (result.status !== "submitted") return { content: [{ type: "text", text: result.reason || "The user cancelled this question." }], isError: true };
        return { content: [{ type: "text", text: JSON.stringify(result.answers) }] };
      }).catch(function (error) { return { content: [{ type: "text", text: "Error: " + error.message }], isError: true }; });
    },
  }];
}

function capability(adapter) {
  return adapter && adapter.userInputCapability ? adapter.userInputCapability : { mode: "fallback", native: false };
}

function selectMode(adapter, requestedMode) {
  if (requestedMode === "fallback") return "fallback";
  if (requestedMode === "native" && capability(adapter).mode !== "native") {
    throw new Error("This provider does not support native structured user input.");
  }
  return capability(adapter).mode === "native" ? "native" : "fallback";
}

function createFallbackServer(adapter, handler) {
  var opts = arguments.length > 2 && arguments[2] ? arguments[2] : {};
  if (!adapter || typeof adapter.createToolServer !== "function") return null;
  if (capability(adapter).mode === "native" && opts.force !== true) return null;
  return adapter.createToolServer({ name: "yoke-user-input", version: "1.0.0", tools: fallbackToolDefs(handler, opts) });
}

module.exports = {
  TOOL_NAME: TOOL_NAME,
  normalizeQuestions: normalizeQuestions,
  questionsFromElicitation: questionsFromElicitation,
  normalizeAnswers: normalizeAnswers,
  dispatchUserInput: dispatchUserInput,
  claudePermissionResult: claudePermissionResult,
  codexResponse: codexResponse,
  elicitationResponse: elicitationResponse,
  fallbackToolDefs: fallbackToolDefs,
  createFallbackServer: createFallbackServer,
  capability: capability,
  selectMode: selectMode,
};
